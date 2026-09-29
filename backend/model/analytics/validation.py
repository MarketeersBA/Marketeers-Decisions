"""Validation charts — ported from ChartForm.validationDoneButton_Click (Reports DLL).

Desktop flow per scenario:
  bind scenario → findPredictedShares() → rebaseProductNewShare(getTotalProductsAuditShare())
  then report Audit Share / Rebased Simulator Share as decimal fractions (/100).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from model.analytics._helpers import clone_project, prepare_analytics_project

if TYPE_CHECKING:
    from data.validation_store import ValidationWave
    from model.project_core import ProjectCore

Level = Literal["sku", "group"]
Layout = Literal["by_series", "by_scenario"]


def _series_names(project: "ProjectCore", level: Level, group_type: str, series: list[str] | None) -> list[str]:
    model = project._model
    if model is None:
        return []
    if series:
        return list(series)
    if level == "group":
        names: list[str] = []
        seen: set[str] = set()
        for g in model.doc.groups:
            if g.group_type != group_type:
                continue
            if g.group_name not in seen:
                seen.add(g.group_name)
                names.append(g.group_name)
        return names
    return [p.name for p in model.included_products()]


def _audit_and_rebased(
    project: "ProjectCore",
    *,
    level: Level,
    group_type: str,
    series_item: str,
) -> tuple[float, float]:
    if level == "group":
        audit = project.get_group_share("AuditShare", group_type, series_item)
        rebased = project.get_group_share("NewShare", group_type, series_item)
    else:
        audit = project.get_product_share("AuditShare", series_item)
        rebased = project.get_product_share("NewShare", series_item)
    return audit / 100.0, rebased / 100.0


def _wave_score_metrics(trial: "ProjectCore") -> tuple[float | None, float | None]:
    abs_deltas: list[float] = []
    audit_weights: list[float] = []
    if trial._model is None:
        return None, None
    for product in trial._model.included_products():
        audit_pp = trial.get_product_share("AuditShare", product.name)
        rebased_pp = trial.get_product_share("NewShare", product.name)
        if audit_pp <= 0:
            continue
        abs_deltas.append(abs(rebased_pp - audit_pp))
        audit_weights.append(audit_pp)
    if not abs_deltas:
        return None, None
    mean_abs = sum(abs_deltas) / len(abs_deltas)
    sum_audit = sum(audit_weights)
    wmape = (sum(abs_deltas) / sum_audit * 100.0) if sum_audit > 0 else None
    return round(mean_abs, 4), round(wmape, 4) if wmape is not None else None


def _brand_group_type(trial: "ProjectCore") -> str | None:
    model = trial._model
    if model is None:
        return None
    types = list(model.group_types)
    for group_type in types:
        if "brand" in group_type.lower():
            return group_type
    return types[0] if types else None


def _competitor_brand_shares(current: "ProjectCore", validation: "ProjectCore") -> list[dict]:
    """Competitor-brand share in the current study and in a validation wave.

    A brand is a competitor when none of its SKUs are flagged as company products.
    ``current`` is the study-base NewShare after the legacy rebase onto the
    validation audit total (same scale as AuditShare). ``validation`` is the
    wave's AuditShare.
    """
    model = validation._model
    if model is None:
        return []
    brand_type = _brand_group_type(validation)
    if not brand_type:
        return []
    company = set(model.company_products)
    seen: set[str] = set()
    rows: list[dict] = []
    for group in model.doc.groups:
        if group.group_type != brand_type or group.group_name in seen:
            continue
        seen.add(group.group_name)
        members = list(group.product_names)
        if not members:
            continue
        if company and any(name in company for name in members):
            continue
        current_share = current.get_group_share("NewShare", brand_type, group.group_name)
        validation_share = validation.get_group_share("AuditShare", brand_type, group.group_name)
        rows.append(
            {
                "name": group.group_name,
                "current": round(current_share, 4),
                "validation": round(validation_share, 4),
            }
        )
    rows.sort(key=lambda row: (-row["validation"], row["name"]))
    return rows


def _run_validation_wave(slug: str, wave: "ValidationWave") -> "ProjectCore":
    from model.project_core import ProjectCore

    base = ProjectCore(slug)
    base.initialize()
    trial = clone_project(base)
    trial.apply_validation_wave(wave)
    trial.find_predicted_shares()
    trial.rebase_product_new_share(trial.get_total_products_audit_share())
    return trial


def validation_series(
    slug: str,
    *,
    metric: str = "company_share",
) -> dict:
    """Build time-ordered chart points for all validation waves on a study."""
    from data.validation_store import ValidationWaveStore

    store = ValidationWaveStore(slug)
    waves = store.load_all()
    points: list[dict] = []
    latest_wave: ValidationWave | None = None
    latest_trial: ProjectCore | None = None
    for wave in waves:
        trial = _run_validation_wave(slug, wave)
        predicted = trial.get_company_share("NewShare")
        actual = trial.get_company_share("AuditShare")
        mean_abs, wmape = _wave_score_metrics(trial)
        points.append(
            {
                "id": wave.id,
                "name": wave.name,
                "date": wave.validation_date,
                "predicted": round(predicted, 4),
                "actual": round(actual, 4),
                "meanAbsDeltaPp": mean_abs,
                "wmape": wmape,
            }
        )
        if latest_wave is None or (wave.created_at or "") >= (latest_wave.created_at or ""):
            latest_wave = wave
            latest_trial = trial
    points.sort(key=lambda p: (p.get("date") or "", p.get("name") or ""))
    latest_brands = None
    if latest_wave is not None and latest_trial is not None:
        from model.project_core import ProjectCore

        current = ProjectCore(slug)
        current.initialize()
        current.find_predicted_shares()
        current.rebase_product_new_share(latest_trial.get_total_products_audit_share())
        latest_brands = {
            "id": latest_wave.id,
            "name": latest_wave.name,
            "date": latest_wave.validation_date,
            "brands": _competitor_brand_shares(current, latest_trial),
        }
    return {"metric": metric, "points": points, "latestBrands": latest_brands}


def _run_scenario(
    base: "ProjectCore",
    scenario_name: str | None,
    filters: list[tuple[str, str]],
) -> "ProjectCore":
    """Clone study, apply optional scenario + filters, predict, rebase to audit total."""
    if scenario_name:
        trial = prepare_analytics_project(
            base.slug, filters=filters, base_scenario=scenario_name
        )
    else:
        trial = clone_project(base)
        if filters:
            trial.apply_segmentation_filters(filters)
        trial.find_predicted_shares()

    trial.find_predicted_shares()
    trial.rebase_product_new_share(trial.get_total_products_audit_share())
    return trial


def validation_rows(
    project: "ProjectCore",
    *,
    level: Level = "sku",
    group_type: str = "Brand",
    series: list[str] | None = None,
    scenarios: list[str] | None = None,
    layout: Layout = "by_scenario",
    filters: list[tuple[str, str]] | None = None,
) -> dict:
    """Build Validation chart tables matching desktop ChartForm columns.

    Returns::
        {
          "level": "sku"|"group",
          "groupType": str,
          "layout": "by_series"|"by_scenario",
          "tables": [
            {
              "title": str,
              "rows": [
                {"label": str, "audit": float, "rebased": float, "delta": float}
              ]
            }
          ]
        }

    Shares are decimal fractions (desktop /100).
    Empty ``scenarios`` means the current project state (already prepared, then rebased).
    """
    filters = filters or []
    series_list = _series_names(project, level, group_type, series)
    scenario_list = list(scenarios) if scenarios else [None]

    # Materialize each scenario once
    runs: list[tuple[str, "ProjectCore"]] = []
    for sc in scenario_list:
        label = sc if sc else (project.scenario_name or "Study base")
        if sc is None and not scenarios:
            trial = clone_project(project)
            trial.find_predicted_shares()
            trial.rebase_product_new_share(trial.get_total_products_audit_share())
            runs.append((label, trial))
        else:
            runs.append((label, _run_scenario(project, sc, filters)))

    tables: list[dict] = []

    if layout == "by_series":
        # Desktop validationByBrandRadiobutton: one table per series item, rows = scenarios
        for item in series_list:
            rows: list[dict] = []
            for sc_label, trial in runs:
                audit, rebased = _audit_and_rebased(
                    trial, level=level, group_type=group_type, series_item=item
                )
                rows.append(
                    {
                        "label": sc_label,
                        "audit": audit,
                        "rebased": rebased,
                        "delta": rebased - audit,
                    }
                )
            tables.append({"title": f"{item} Validation", "seriesItem": item, "rows": rows})
    else:
        # Desktop validationByMonthRadioButton: one table per scenario, rows = series
        for sc_label, trial in runs:
            rows = []
            for item in series_list:
                audit, rebased = _audit_and_rebased(
                    trial, level=level, group_type=group_type, series_item=item
                )
                rows.append(
                    {
                        "label": item,
                        "audit": audit,
                        "rebased": rebased,
                        "delta": rebased - audit,
                    }
                )
            tables.append({"title": f"{sc_label} Validation", "scenario": sc_label, "rows": rows})

    return {
        "level": level,
        "groupType": group_type,
        "layout": layout,
        "tables": tables,
    }


def validation_scenario_score(
    slug: str,
    scenario_name: str,
    *,
    level: Level = "sku",
    group_type: str = "Brand",
) -> dict:
    """Aggregate validation fit for a validation-flagged scenario vs study audit shares.

    Pipeline matches ChartForm: apply scenario → predict → rebase to audit total → compare.
    Returns meanAbsDeltaPp (equal SKU weight), wmape (audit-weighted), maxAbsDeltaPp.
    """
    from data.scenario_store import ScenarioStore
    from model.project_core import ProjectCore

    store = ScenarioStore(slug)
    if not store.exists(scenario_name):
        raise FileNotFoundError(f"Scenario not found: {scenario_name}")
    scenario = store.load(scenario_name)
    if not scenario.validation:
        raise ValueError(f"Scenario is not flagged as validation: {scenario_name}")

    trial = _run_scenario(
        ProjectCore(slug),
        scenario_name,
        filters=[],
    )
    audit_total = trial.get_total_products_audit_share()
    if audit_total <= 0:
        return {
            "scenario": scenario_name,
            "hasAudit": False,
            "meanAbsDeltaPp": None,
            "wmape": None,
            "maxAbsDeltaPp": None,
            "skuCount": 0,
        }

    if level == "group":
        series_list = _series_names(trial, "group", group_type, None)
        abs_deltas: list[float] = []
        audit_weights: list[float] = []
        for item in series_list:
            audit_dec, rebased_dec = _audit_and_rebased(
                trial, level="group", group_type=group_type, series_item=item
            )
            audit_pp = audit_dec * 100.0
            rebased_pp = rebased_dec * 100.0
            if audit_pp <= 0:
                continue
            abs_deltas.append(abs(rebased_pp - audit_pp))
            audit_weights.append(audit_pp)
    else:
        abs_deltas = []
        audit_weights = []
        for product in trial._model.included_products() if trial._model else []:
            audit_pp = trial.get_product_share("AuditShare", product.name)
            rebased_pp = trial.get_product_share("NewShare", product.name)
            if audit_pp <= 0:
                continue
            abs_deltas.append(abs(rebased_pp - audit_pp))
            audit_weights.append(audit_pp)

    if not abs_deltas:
        return {
            "scenario": scenario_name,
            "hasAudit": False,
            "meanAbsDeltaPp": None,
            "wmape": None,
            "maxAbsDeltaPp": None,
            "skuCount": 0,
        }

    sum_audit = sum(audit_weights)
    mean_abs = sum(abs_deltas) / len(abs_deltas)
    wmape = (sum(abs_deltas) / sum_audit * 100.0) if sum_audit > 0 else None

    return {
        "scenario": scenario_name,
        "hasAudit": True,
        "meanAbsDeltaPp": round(mean_abs, 4),
        "wmape": round(wmape, 4) if wmape is not None else None,
        "maxAbsDeltaPp": round(max(abs_deltas), 4),
        "skuCount": len(abs_deltas),
    }
