"""ProjectCore facade — pure Python, folder-per-study."""

from __future__ import annotations

import copy
from pathlib import Path

import pandas as pd

from config import NUMBER_FORMAT, study_folder
from data.scenario_store import ScenarioData, ScenarioStore
from data.validation_store import ValidationWave
from data.study_loader import load_study_document
from model.attribute_engine import AttributeEngine
from model.share_engine import ShareEngine
from model.study_model import StudyModel


class ProjectRegistry:
    _instance: ProjectRegistry | None = None

    def __init__(self) -> None:
        self._projects: dict[str, ProjectCore] = {}

    @classmethod
    def instance(cls) -> ProjectRegistry:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def initialize_projects(self, slug: str) -> None:
        main = ProjectCore(slug)
        main.initialize()
        base = ProjectCore(slug)
        base.initialize()
        self._projects["MainStudy"] = main
        self._projects["BaseScenario"] = base

    def get(self, name: str) -> ProjectCore:
        if name not in self._projects:
            raise KeyError(f"Project '{name}' not initialized")
        return self._projects[name]

    def clear(self) -> None:
        self._projects.clear()


class ProjectCore:
    study_slug: str | None = None

    def __init__(self, slug: str, client_id: str | None = None) -> None:
        self.slug = slug
        self.client_id = client_id
        self._model: StudyModel | None = None
        self._base_model: StudyModel | None = None
        self._results_df: pd.DataFrame | None = None
        self._attr_engine = AttributeEngine()
        self._share_engine = ShareEngine()
        self.scenario_name = ""

    @property
    def backend(self) -> str:
        return "python"

    @property
    def study_name(self) -> str:
        return self._model.study_name if self._model else ""

    @property
    def company_name(self) -> str:
        return self._model.company_name if self._model else ""

    @property
    def category(self) -> str:
        return self._model.category if self._model else ""

    @property
    def market(self) -> str:
        return self._model.market if self._model else ""

    @property
    def base(self) -> str:
        return self._model.base if self._model else ""

    @property
    def doc(self):
        return self._model.doc if self._model else None

    @property
    def financial(self) -> bool:
        return bool(self._model.financial) if self._model else False

    @property
    def use_grouping(self) -> bool:
        return bool(self._model.use_grouping) if self._model else False

    @property
    def product_count(self) -> int:
        return len(self._model.products) if self._model else 0

    @property
    def respondent_count(self) -> int:
        return self._model.n_respondents if self._model else 0

    @property
    def price_currency_symbol(self) -> str:
        if self._model and self._model.doc:
            return self._model.doc.meta.price_currency_symbol or "€"
        return "€"

    @property
    def size_unit_label(self) -> str:
        if self._model and self._model.doc:
            return self._model.doc.meta.size_unit_label or "L"
        return "L"

    @property
    def discrete_attributes(self) -> list[str]:
        return list(self._model.discrete_attrs) if self._model else []

    @property
    def group_types(self) -> list[str]:
        return list(self._model.group_types) if self._model else []

    def active_segmentation_label(self) -> str | None:
        return self._model.active_segmentation_label() if self._model else None

    def segmentation_dimensions(self) -> list[tuple[str, str]]:
        return self._model.segmentation_dimension_options() if self._model else []

    def segment_members(self, assignment_key: str) -> list[str]:
        return self._model.members_for_segment(assignment_key) if self._model else []

    def apply_segmentation_filters(
        self, filters: list[tuple[str, str]], *, reload: bool = True
    ) -> None:
        if self._model:
            self._model.set_segmentation_filters(filters)
            if reload:
                self.reload_results()

    def apply_segmentation_from_session(
        self,
        assignment_key: str | None,
        member: str | None,
        *,
        filters: list[tuple[str, str]] | None = None,
        reload: bool = True,
    ) -> None:
        if filters is not None:
            self.apply_segmentation_filters(filters, reload=reload)
        elif assignment_key and member:
            self.apply_segmentation_filters([(assignment_key, member)], reload=reload)
        else:
            self.apply_segmentation_filters([], reload=reload)

    def initialize(self) -> None:
        doc, hbu = load_study_document(self.slug, self.client_id)
        self._model = StudyModel(doc, hbu)
        self._base_model = StudyModel(doc, hbu)
        ProjectCore.study_slug = self.slug
        self.reload_results()

    def reload_results(self) -> pd.DataFrame:
        if self._model is None:
            self._results_df = pd.DataFrame()
            return self._results_df
        self._results_df = self._share_engine.to_results_dataframe(self._model)
        return self._results_df

    @property
    def results(self) -> pd.DataFrame:
        if self._results_df is None:
            return self.reload_results()
        return self._results_df

    def change_product_attribute(
        self, product: str, attribute: str, value: str, *, reload: bool = True
    ) -> None:
        if self._model:
            if attribute == "NOS":
                p = self._model.get_product(product)
                if p:
                    p.new_nos = float(value) if value else None
            elif attribute == "TDC":
                p = self._model.get_product(product)
                if p:
                    p.new_tdc = float(value) if value else None
            else:
                self._attr_engine.change(self._model, product, attribute, value)
            if reload:
                self.reload_results()

    def include_exclude_product(self, product: str, include: bool, *, reload: bool = True) -> None:
        if self._model:
            self._attr_engine.include_exclude(self._model, product, include)
            if reload:
                self.reload_results()

    def set_segmentation(self, segment_type: str, segment_member: str) -> None:
        if self._model:
            self._model.set_segmentation(segment_type, segment_member)
            self.reload_results()

    def reset_segmentation(self) -> None:
        if self._model:
            self._model.clear_segmentation()
            self.reload_results()

    def get_active_segments(self) -> list[tuple[str, str]]:
        return list(self._model.active_segments) if self._model else []

    def get_segmentation(self) -> list[str]:
        segs = self.get_active_segments()
        if len(segs) == 1:
            return [segs[0][0], segs[0][1]]
        return []

    def group_summary(self, group_type: str = "Brand") -> list[dict]:
        from model.groups import group_metric_rows

        if self._model is None:
            return []
        return group_metric_rows(self._model, group_type)

    def reset_products(self, *, reload: bool = True) -> None:
        if self._model:
            self._model.reset()
            if reload:
                self.reload_results()

    def find_predicted_shares(self) -> None:
        self.reload_results()

    def som_vs_sop(self) -> list[dict[str, str | float]]:
        from model.analytics.som_sop import som_vs_sop

        return som_vs_sop(self)

    def get_product_share(self, share_type: str, product: str) -> float:
        if self._model is None:
            return 0.0
        p = self._model.get_product(product)
        if p is None:
            return 0.0
        if share_type == "BaseMarketShare":
            if p.product_type == "ReplacedProduct" and p.base_product_id > 0:
                base = self._model.product_by_id(p.base_product_id)
                return base.base_share if base else 0.0
            return p.base_share
        if share_type == "NewShare":
            return p.new_share
        if share_type == "PreferenceShare":
            return p.new_preference_share
        if share_type == "AuditShare":
            return p.audit_share
        row = self.results[self.results["Product Name"] == product]
        if row.empty:
            return 0.0
        mapping = {
            "BaseMarketShare": "B.Share",
            "NewShare": "N.Share",
            "PreferenceShare": "Preference Share",
            "AuditShare": "Audit Share",
        }
        col = mapping.get(share_type, share_type)
        return float(row.iloc[0].get(col, 0.0))

    def get_total_products_audit_share(self) -> float:
        if self._model is None:
            return 0.0
        return sum(p.audit_share for p in self._model.products)

    def get_total_products_new_share(self) -> float:
        if self._model is None:
            return 0.0
        return sum(p.new_share for p in self._model.products)

    def rebase_product_new_share(self, rebase_value: float) -> None:
        if self._model is None:
            return
        total = sum(p.new_share for p in self._model.products)
        if total <= 0 or rebase_value == 0:
            return
        for p in self._model.products:
            p.new_share = p.new_share * rebase_value / total

    def get_group_share(self, share_type: str, group_type: str, member_name: str) -> float:
        if self._model is None:
            return 0.0
        members: list[str] = []
        for g in self._model.doc.groups:
            if g.group_type == group_type and g.group_name == member_name:
                members = list(g.product_names)
                break
        total = 0.0
        for name in members:
            if share_type == "NewShare":
                p = self._model.get_product(name)
                if p is None or not p.included:
                    continue
                total += p.new_share
            else:
                total += self.get_product_share(share_type, name)
        return total

    def get_product_revenue(self, product: str) -> float:
        row = self.results[self.results["Product Name"] == product]
        return float(row.iloc[0]["Revenue"]) if not row.empty else 0.0

    def get_product_value_share(self, product: str) -> float:
        row = self.results[self.results["Product Name"] == product]
        return float(row.iloc[0]["Value Share"]) if not row.empty else 0.0

    def apply_scenario(self, scenario: ScenarioData) -> None:
        if not self._model:
            return
        self.reset_products(reload=False)
        for product, overrides in scenario.product_overrides.items():
            for attr, val in overrides.items():
                self.change_product_attribute(product, attr, str(val), reload=False)
        for product, included in scenario.included_products.items():
            self.include_exclude_product(product, included, reload=False)
        if scenario.segmentation:
            self.apply_segmentation_filters(list(scenario.segmentation.items()), reload=False)
        self.scenario_name = scenario.name
        self.reload_results()

    def apply_validation_wave(self, wave: ValidationWave) -> None:
        """Apply validation-period inputs and benchmark audit shares (legacy scenario bind parity)."""
        if not self._model:
            return
        self.reset_products(reload=False)
        for sku, row in wave.products.items():
            p = self._model.get_product(sku)
            if p is None:
                continue
            for attr, val in row.attributes.items():
                self.change_product_attribute(sku, attr, str(val), reload=False)
            if row.wd is not None:
                p.new_wd = row.wd
            p.audit_share = row.benchmark_share_pp
        self.scenario_name = wave.name
        self.reload_results()

    def _segmentation_dict(self) -> dict[str, str]:
        return {k: m for k, m in self.get_active_segments()}

    def get_company_share(self, share_type: str = "NewShare") -> float:
        total = 0.0
        for name in self.company_products:
            total += self.get_product_share(share_type, name)
        return total

    def get_company_revenue(self) -> float:
        return sum(self.get_product_revenue(name) for name in self.company_products)

    def capture_scenario(self, name: str, description: str = "", validation: bool = False) -> ScenarioData:
        overrides: dict[str, dict] = {}
        included: dict[str, bool] = {}
        if self._model:
            for p in self._model.products:
                included[p.name] = p.included
                prod_overrides = dict(p.new_attributes)
                prod_overrides["WD"] = p.new_wd
                overrides[p.name] = prod_overrides
        return ScenarioData(
            name=name,
            description=description,
            validation=validation,
            product_overrides=overrides,
            included_products=included,
            segmentation=self._segmentation_dict(),
            use_grouping=self.use_grouping,
            financial=self.financial,
        )

    @staticmethod
    def format_number(value: float) -> str:
        return NUMBER_FORMAT.format(value)

    def is_financial_enabled(self) -> bool:
        return self.financial

    @property
    def all_products(self) -> list[str]:
        return self._model.all_product_names if self._model else []

    @property
    def company_products(self) -> list[str]:
        return self._model.company_products if self._model else []

    @staticmethod
    def study_exists(slug: str, client_id: str | None = None) -> bool:
        from api.deps import resolve_client_id
        from config import get_storage

        cid = client_id or resolve_client_id()
        return get_storage().study_exists(cid, slug)
