// Shared segment/scenario setup helpers + optimizer API response types.
import type { SegmentationState } from "./types";
import type { ResultRow } from "./types";

export interface OptimizerSetup {
  assignment_key?: string | null;
  member?: string | null;
  filters?: { assignment_key: string; member: string }[] | null;
  base_scenario?: string | null;
}

export interface CompetitorMove {
  brand: string;
  pct: number;
}

export function optimizerQueryString(setup: OptimizerSetup): string {
  const p = new URLSearchParams();
  if (setup.filters && setup.filters.length > 0) {
    p.set("filters", JSON.stringify(setup.filters));
  } else {
    if (setup.assignment_key) p.set("assignment_key", setup.assignment_key);
    if (setup.member) p.set("member", setup.member);
  }
  if (setup.base_scenario) p.set("base_scenario", setup.base_scenario);
  const qs = p.toString();
  return qs ? `&${qs}` : "";
}

export function buildOptimizerSetup(
  segmentation: SegmentationState | undefined,
  baseScenario: string | null,
): OptimizerSetup {
  const activeFilters =
    segmentation?.activeFilters ??
    (segmentation?.active ? [segmentation.active] : []);
  return {
    filters:
      activeFilters.length > 0
        ? activeFilters.map((f) => ({
            assignment_key: f.assignmentKey,
            member: f.member,
          }))
        : null,
    assignment_key: segmentation?.active?.assignmentKey ?? null,
    member: segmentation?.active?.member ?? null,
    base_scenario: baseScenario || null,
  };
}

export interface OptimizerScenarioListItem {
  name: string;
  description?: string;
  validation?: boolean;
  file?: string;
  created_at?: string;
}

export interface OptimizerContextResponse {
  group_types: string[];
  /** group_type → brand → SKU names */
  groups_by_type: Record<string, Record<string, string[]>>;
  /** Convenience: groups for default_group_type */
  groups: Record<string, string[]>;
  default_group_type: string;
  uses_fallback_groups: boolean;
  segmentation?: unknown;
  scenarios?: OptimizerScenarioListItem[];
}

export interface OptimizerBrandSku {
  name: string;
  base_price: number;
  b_share: number;
  n_share: number;
  revenue: number;
  value_share?: number;
  /** Unit size from the study's size attribute; null when the study has none. */
  size?: number | null;
  unit_cost?: number;
  /** Study lineup inclusion (results grid Selected); false = excluded from the market. */
  included?: boolean;
}

export interface OptimizerBrandSummaryResponse {
  kpis: {
    skus_count: number;
    volume_share: number;
    revenue: number;
    value_share: number;
  };
  skus: OptimizerBrandSku[];
  segmentation?: unknown;
  base_scenario?: string | null;
}

export interface OptimizerBrandSummariesResponse {
  brands: Record<string, OptimizerBrandSummaryResponse>;
  segmentation?: unknown;
  base_scenario?: string | null;
}

export interface CorridorPreviewPoint {
  index: number;
  price: number;
  ref_sku_cm_pct: number | null;
  /** Ref SKU volume × (price - cost); an inverted U in price. */
  ref_sku_contribution: number;
  /** ref_sku_contribution vs baseline × 100 (today = 100). */
  ref_sku_contribution_index: number;
  ref_sku_revenue?: number;
  /** Volume vs baseline × 100 (base shelf price = 100). */
  ref_sku_volume_index?: number;
  /** Revenue vs baseline × 100 (base shelf price = 100). */
  ref_sku_revenue_index?: number;
  /** Sales-margin $ vs baseline × 100 (same as contribution index). */
  ref_sku_margin_index?: number;
  brand_cm_pct: number;
  brand_contribution: number;
  brand_contribution_index: number;
  ref_sku_volume: number;
  brand_volume: number;
  ref_sku_volume_drop_pct: number;
  brand_volume_drop_pct: number;
  /** True when this point is today's base shelf price (indexes = 100). */
  is_current?: boolean;
  feasible: boolean;
  cm_ok: boolean;
  vol_ok: boolean;
}

export interface CorridorPreviewBound {
  index: number;
  price: number;
  brand_cm_pct: number;
  ref_sku_cm_pct: number | null;
  ref_sku_contribution: number;
  ref_sku_contribution_index: number;
  brand_volume_drop_pct: number;
  ref_sku_volume_drop_pct: number;
  brand_contribution: number;
}

export interface CorridorPreviewRequest {
  group_type: string;
  brand: string;
  reference_sku: string;
  anchor_price: number;
  anchor_label?: string | null;
  anchor_sku?: string | null;
  index_min?: number;
  index_max?: number;
  index_step?: number | null;
  n_points?: number;
  min_margin_pct?: number | null;
  max_volume_drop_pct?: number | null;
  filters?: { assignment_key: string; member: string }[] | null;
  assignment_key?: string | null;
  member?: string | null;
  base_scenario?: string | null;
  competitor_moves?: CompetitorMove[] | null;
}

export interface CorridorPreviewResponse {
  group_type: string;
  brand: string;
  reference_sku: string;
  anchor_label?: string | null;
  anchor_sku?: string | null;
  anchor_price: number;
  min_margin_pct?: number | null;
  max_volume_drop_pct?: number | null;
  /** Exact price where ref-SKU CM% equals the margin floor: cost / (1 - floor). */
  margin_floor_price?: number | null;
  calibrated_price_lo?: number | null;
  calibrated_price_hi?: number | null;
  points: CorridorPreviewPoint[];
  warnings?: string[];
  bounds: {
    min: CorridorPreviewBound | null;
    max: CorridorPreviewBound | null;
    recommended: CorridorPreviewBound | null;
    min_binding_label?: string;
    max_binding_label?: string;
    binding_label: string;
    feasible_count: number;
  };
  baseline?: Record<string, number | null>;
  definitions?: Record<string, string>;
  competitor_moves?: CompetitorMove[] | null;
}

export interface OptimizerBoundsSku {
  sku: string;
  base_price: number;
  lo: number;
  hi: number;
  cost: number;
}

export interface SkuBoundInput {
  sku: string;
  base_price: number;
  lo: number;
  hi: number;
  cost: number;
  included: boolean;
}

export interface PpaTierLink {
  high_sku: string;
  low_sku: string;
  min_premium_pct?: number | null;
}

export interface RunOptimizerRequest {
  group_type: string;
  brand: string;
  bounds: SkuBoundInput[];
  objective: string;
  scope?: string;
  algorithm?: string;
  max_iters?: number;
  /** "full" = 5 multi-starts (default); "current" = start from base prices only */
  multi_start?: "full" | "current";
  grid_points?: number;
  tol_str?: string;
  run_global?: boolean;
  max_volume_drop_pct?: number | null;
  min_margin_pct?: number | null;
  reference_sku?: string | null;
  anchor_label?: string | null;
  anchor_price?: number | null;
  corridor_basis?: string;
  corridor_min?: number | null;
  corridor_max?: number | null;
  enforce_ppa_ladder?: boolean;
  ppa_size_chains?: string[][];
  ppa_tier_links?: PpaTierLink[];
  ppa_min_saving?: number | null;
  ppa_max_saving?: number | null;
  competitor_moves?: CompetitorMove[] | null;
  filters?: { assignment_key: string; member: string }[] | null;
  assignment_key?: string | null;
  member?: string | null;
  base_scenario?: string | null;
}

export interface OptimizerSkuRow {
  name: string;
  optimized: boolean;
  base_price: number;
  optimal_price: number;
  raw_price?: number;
  lo: number;
  hi: number;
  price_delta_pct: number;
  bound_hit?: string | null;
  limited_by?: string | null;
  base_vol_share: number;
  new_vol_share: number;
  share_delta_pp: number;
  base_rev: number;
  new_rev: number;
  rev_delta_pct: number;
  base_val_share: number;
  new_val_share: number;
}

export interface OptimizerMarketRow {
  name: string;
  new_price: number;
  b_share: number;
  n_share: number;
  s_index: number;
  revenue: number;
  r_index: number;
  value_share: number;
  /** Baseline value share; present on newer API responses. */
  base_val_share?: number;
}

export interface PpaLadderRow {
  sku: string;
  price: number;
  size: number;
  unit_price: number;
  saving_vs_prev: number | null;
  status: "ok" | "fail";
  detail: string | null;
  is_tier_link?: boolean;
  chain_idx?: number;
  tier_premium_vs_low?: number | null;
  /** @deprecated Legacy backend field; prefer tier_premium_vs_low */
  premium_vs_low?: number | null;
  low_sku?: string | null;
}

export interface OptimizerRunResult {
  prices: Record<string, number>;
  objective_value: number;
  baseline_value: number;
  uplift_pct: number;
  n_evals: number;
  solution_status: string;
  constraint_conflicts: string[];
  limited_by: Record<string, string>;
  sku_rows: OptimizerSkuRow[];
  ppa_ladder_rows?: PpaLadderRow[];
  /** Full-market recalc after optimization — used for competitor SKU deltas. */
  market_rows?: OptimizerMarketRow[];
  /** Simulator grid after optimization — same columns as the Price Simulation page. */
  scenario_columns?: string[];
  scenario_results?: ResultRow[];
  brand_totals?: {
    base_rev: number;
    new_rev: number;
    rev_delta_pct: number;
    base_vol: number;
    new_vol: number;
    vol_delta_pp: number;
    base_val: number;
    new_val: number;
    val_delta_pp: number;
    /** Brand CM% (Σ revenue×(p−cost)/p / Σ revenue) from optimizer bounds unit costs. */
    base_cm_pct?: number;
    new_cm_pct?: number;
    cm_delta_pp?: number;
  };
  baseline_brand_volume?: number;
  final_brand_volume?: number;
  brand_volume_drop_pct?: number;
  max_volume_drop_pct?: number | null;
  duration_ms?: number | null;
  menus?: Record<string, number[]>;
}

export interface OptimizerJobResponse {
  status: "running" | "done" | "cancelled" | "error";
  evals: number;
  estimated_evals: number;
  best_obj: number;
  error: string | null;
  result: OptimizerRunResult | null;
}

export interface RunOptimizerStartResponse {
  job_id: string;
  estimated_evals: number;
}
