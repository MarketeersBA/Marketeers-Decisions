"""Pydantic request models. Responses are plain dicts (see serializers.py)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    slug: str


class GridChange(BaseModel):
    product: str
    column: str
    value: str | float | int | bool | None = None


class RecalculateRequest(BaseModel):
    changes: list[GridChange] = Field(default_factory=list)


class SegmentFilter(BaseModel):
    assignment_key: str
    member: str


class SegmentationRequest(BaseModel):
    assignment_key: str | None = None
    member: str | None = None
    filters: list[SegmentFilter] | None = None


class SaveScenarioRequest(BaseModel):
    session_id: str
    name: str
    description: str = ""
    validation: bool = False


class ApplyScenarioRequest(BaseModel):
    name: str


class CompetitorMove(BaseModel):
    """Expected price change for every SKU in a competitor brand, as a percent of current price."""

    brand: str
    pct: float = 0.0


class CompetitorReactionRequest(BaseModel):
    """Apply competitor price moves on the session, save as a named scenario, and leave it loaded."""

    group_type: str
    moves: list[CompetitorMove]
    name: str = ""
    description: str = ""


class UpdateStudyRequest(BaseModel):
    name: str | None = None
    company: str | None = None
    set_default: bool = False
    data_period: str | None = None
    data_source: str | None = None


class ReorderScenariosRequest(BaseModel):
    order: list[str]


class ImportScenariosRequest(BaseModel):
    names: list[str] | None = None


class CreateStudyRequest(BaseModel):
    wizard_id: str
    name: str
    company: str = ""
    category: str = ""
    market: str = ""
    exponent_factor: float = 1.0
    msu: float = 1.0
    su: float = 1.0
    vsu: float = 0.0
    price_currency_symbol: str = Field(default="€", min_length=1, max_length=8)
    size_unit_label: str = Field(default="L", min_length=1, max_length=16)
    design_source_filename: str = ""
    hbu_source_filename: str = ""
    data_period: str = ""
    data_source: str = ""


class PatchStudyMetaRequest(BaseModel):
    price_currency_symbol: str | None = Field(default=None, min_length=1, max_length=8)
    size_unit_label: str | None = Field(default=None, min_length=1, max_length=16)


class CompareRequest(BaseModel):
    scenarios: list[str]


class SkuBoundInput(BaseModel):
    sku: str
    base_price: float
    lo: float
    hi: float
    cost: float = 0.0
    included: bool = True


class PpaTierLink(BaseModel):
    high_sku: str
    low_sku: str
    min_premium_pct: float | None = None


class RunOptimizerRequest(BaseModel):
    group_type: str
    brand: str
    bounds: list[SkuBoundInput]
    objective: str = "revenue"
    scope: str = "brand"
    max_iters: int = 15
    multi_start: str = "full"  # "full" | "current"
    tol_str: str = "1e-5"
    max_volume_drop_pct: float | None = None  # max brand volume drop vs baseline, e.g. 10 = 10%
    # Segment filters (null = all respondents). Prefer filters[] for multi-segment AND.
    filters: list[SegmentFilter] | None = None
    assignment_key: str | None = None
    member: str | None = None
    # Optional saved scenario as starting point (null = study base prices).
    base_scenario: str | None = None
    # Competitor price shocks applied after base_scenario; this is the start market.
    competitor_moves: list[CompetitorMove] | None = None

    # ── Reference SKU / competitive anchor / price corridor (optional) ──────
    # reference_sku must be one of bounds[].sku (a decision SKU being positioned).
    reference_sku: str | None = None
    anchor_label: str | None = None      # e.g. "Sagres 33cl (competitor)" — display only
    anchor_price: float | None = None    # fixed competitor / benchmark price snapshot
    anchor_size: float | None = None     # anchor's unit size, required for corridor_basis="unit"
    corridor_basis: str = "pack"         # "pack" | "unit" (price per unit size)
    corridor_min: float | None = None    # e.g. 0.95 -> reference must be >= 0.95x anchor
    corridor_max: float | None = None    # e.g. 1.08 -> reference must be <= 1.08x anchor

    # ── Pack Price Architecture — enforce a size-ordered price ladder ───────
    enforce_ppa_ladder: bool = False
    ppa_size_chains: list[list[str]] | None = None
    ppa_tier_links: list[PpaTierLink] | None = None
    ppa_min_saving: float | None = None  # min €/unit saving fraction moving up a size
    ppa_max_saving: float | None = None  # max €/unit saving fraction moving up a size

    # ── Margin / movement / shelf-price snap (optional) ─────────────────────
    min_margin_pct: float | None = None          # percent points, e.g. 34 = 34% margin floor


class SaveOptimizerScenarioRequest(BaseModel):
    name: str
    description: str = ""


class CorridorPreviewRequest(BaseModel):
    """Before-run reference-SKU price sweep vs a competitive anchor."""

    group_type: str
    brand: str
    reference_sku: str
    anchor_price: float
    anchor_label: str | None = None
    anchor_sku: str | None = None
    index_min: float | None = None
    index_max: float | None = None
    index_step: float | None = None
    n_points: int = 10
    # Guardrails as percent points (34 = 34%, 10 = 10%), matching the Optimizer UI sliders.
    min_margin_pct: float | None = None
    max_volume_drop_pct: float | None = None
    filters: list[SegmentFilter] | None = None
    assignment_key: str | None = None
    member: str | None = None
    base_scenario: str | None = None
    competitor_moves: list[CompetitorMove] | None = None

