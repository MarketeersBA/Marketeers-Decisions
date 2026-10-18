import { Fragment, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { usePageActive } from "../hooks/usePageActive";
import { useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ResultRow } from "../api/types";
import type { CrossBrandData } from "../api/analytics_types";
import { ScenarioCompareChart } from "../components/ScenarioCompareChart";
import { toScenarioComparePoints } from "../lib/scenarioCompareChart";
import {
  useAnalytics,
  useApplyScenario,
  useCorridorPreview,
  useOptimizerBounds,
  useOptimizerBrandSummaries,
  useOptimizerContext,
  useValidationSeries,
  runOptimizerJob,
  saveOptimizerScenario,
} from "../api/hooks";
import type {
  CompetitorMove,
  CorridorPreviewBound,
  CorridorPreviewPoint,
  OptimizerBrandSku,
  OptimizerMarketRow,
  OptimizerRunResult,
  RunOptimizerRequest,
} from "../api/optimizer_types";
import { buildOptimizerSetup } from "../api/optimizer_types";
import { filterStandaloneOfferSkusFromMap } from "../components/assortment/assortmentFilterUtils";
import { buildBaseQueryParams } from "../components/analytics/utils";
import { useStudyDisplay } from "../lib/studyDisplay";
import {
  getRecommendationConfidence,
  validationScoreFromWavePoint,
  recommendationConfidenceLabel,
} from "../lib/validationConfidence";
import { useSession } from "../stores/sessionStore";

import "./pages.css";
import "./optimizer.css";

/**
 * Brand Price Optimizer — Focus brand + reference-SKU response curve
 * wired to `/optimizer/{context,brand-summaries,bounds,corridor-preview,run}`.
 */

type Objective = "ValueShare" | "Share" | "Margin";

function objectiveToBackend(objective: Objective): string {
  if (objective === "Margin") return "margin";
  if (objective === "Share") return "volume_share";
  return "value_share";
}

/** Short label for scenario names: volume / value / margin. */
function objectiveScenarioLabel(objective: Objective): string {
  if (objective === "Share") return "volume";
  if (objective === "ValueShare") return "value";
  return "margin";
}

function formatMovePct(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

function scenarioNameFromMoves(moves: CompetitorMove[]): string {
  return moves.map((m) => `${m.brand} ${formatMovePct(m.pct)}`).join(" · ");
}

function formatLimitedBy(key: string | null | undefined): string {
  if (!key) return "objective";
  const labels: Record<string, string> = {
    corridor_min: "competitive corridor (min)",
    corridor_max: "competitive corridor (max)",
    margin_floor: "min contribution margin",
    bound_min: "price floor",
    bound_max: "price ceiling",
    movement_floor: "max movement (min)",
    movement_ceiling: "max movement",
    max_volume_drop: "max volume drop",
  };
  return labels[key] ?? key.replace(/_/g, " ");
}

function downloadOptimizerDebugBundle(payload: {
  slug: string;
  request: RunOptimizerRequest;
  error: string | null;
  result: OptimizerRunResult | null;
  ui: Record<string, unknown>;
}) {
  const body = {
    exported_at: new Date().toISOString(),
    study_slug: payload.slug,
    error: payload.error,
    request: payload.request,
    result: payload.result,
    ui: payload.ui,
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `optimizer-debug-${payload.slug}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvCellFromRowValue(
  value: string | number | boolean | string[] | null | undefined,
): string | number | null | undefined {
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return value ?? "";
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

function downloadCsvFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildRawScenarioCsvSection(
  columns: string[],
  rows: ResultRow[],
): string[] {
  if (columns.length === 0 || rows.length === 0) {
    return ["Raw scenario", csvRow(["(no grid data — re-run the optimizer)"])];
  }
  return [
    "Raw scenario",
    csvRow(columns),
    ...rows.map((row) => csvRow(columns.map((col) => csvCellFromRowValue(row[col])))),
  ];
}

function buildOptimizerResultsCsv(args: {
  focusBrand: string;
  perUnit: boolean;
  perUnitColumnLabel: string;
  tableRows: OptTableRow[];
  scenarioColumns: string[];
  scenarioResults: ResultRow[];
}): string {
  const lines: string[] = [
    csvRow(["Focus brand", args.focusBrand]),
    csvRow(["Exported at", new Date().toISOString()]),
    "",
    ...buildRawScenarioCsvSection(args.scenarioColumns, args.scenarioResults),
    "",
    "Results table",
    csvRow([
      "Brand",
      "Tier",
      "SKU",
      ...(args.perUnit
        ? [`Current ${args.perUnitColumnLabel}`, `Recommended ${args.perUnitColumnLabel}`, "Discount"]
        : []),
      "Current price",
      "Recommended price",
      "Base volume share",
      "New volume share",
      "Volume share gain",
      "New revenue index",
      "Optimized",
      "Limited by",
    ]),
    ...args.tableRows.map((row) =>
      csvRow([
        row.brand,
        row.tier,
        row.name,
        ...(args.perUnit ? [row.currentText, row.recText, row.discountText] : []),
        row.unitPriceText,
        row.recUnitPriceText,
        row.baseVolShareText,
        row.newVolShareText,
        row.volShareGainText,
        row.revIndexText,
        row.optimized ? "Y" : "N",
        row.limitedBy,
      ]),
    ),
  ];
  return lines.join("\n");
}

function downloadOptimizerResultsCsv(args: {
  slug: string;
  focusBrand: string;
  perUnit: boolean;
  perUnitColumnLabel: string;
  tableRows: OptTableRow[];
  runResult: OptimizerRunResult;
}) {
  const csv = buildOptimizerResultsCsv({
    focusBrand: args.focusBrand,
    perUnit: args.perUnit,
    perUnitColumnLabel: args.perUnitColumnLabel,
    tableRows: args.tableRows,
    scenarioColumns: args.runResult.scenario_columns ?? [],
    scenarioResults: args.runResult.scenario_results ?? [],
  });
  const safeBrand = args.focusBrand.replace(/[<>:"/\\|?*]/g, "_");
  downloadCsvFile(`${args.slug}_${safeBrand}_optimizer_results.csv`, csv);
}

/** Map preview min/max pack prices to run corridor ratios vs the competitive anchor. */
function corridorRatiosFromPreview(
  bounds: {
    min?: { price: number } | null;
    max?: { price: number } | null;
  } | null,
  anchorPrice: number | null,
): { corridor_min: number | null; corridor_max: number | null } {
  if (!bounds || !anchorPrice || anchorPrice <= 0) {
    return { corridor_min: null, corridor_max: null };
  }
  const minPrice = bounds.min?.price;
  const maxPrice = bounds.max?.price;
  return {
    corridor_min:
      minPrice != null && minPrice > 0 ? minPrice / anchorPrice : null,
    corridor_max:
      maxPrice != null && maxPrice > 0 ? maxPrice / anchorPrice : null,
  };
}

interface Product {
  brand: string;
  name: string;
  bShare: number;
  basePrice: number;
  /** Unit size from the study's size attribute; null when the study has none. */
  size: number | null;
  unitCost: number | null;
  valueShare: number;
  revenue: number;
}

/** Fallback unit cost when the study exposes none, as a share of base price. */
/** Shock focus reference SKU price by this factor; matches analytics cross-brand default up-move. */
const PRICE_SHOCK_MULT = 1.1;
const PRICE_SHOCK_PCT = Math.round((PRICE_SHOCK_MULT - 1) * 100);
const PRICE_SHOCK_SCENARIO_KEY = `${PRICE_SHOCK_MULT.toFixed(2)}x`;

function fmt(n: number, d = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

type CompareScope = "brand" | "manufacturer";

function aggregateMarketScope(
  rows: OptimizerMarketRow[],
  skuNames: Set<string>,
): {
  baseVol: number;
  newVol: number;
  baseVal: number;
  newVal: number;
  baseRev: number;
  newRev: number;
} {
  let baseVol = 0;
  let newVol = 0;
  let baseVal = 0;
  let newVal = 0;
  let baseRev = 0;
  let newRev = 0;
  for (const row of rows) {
    if (!skuNames.has(row.name)) continue;
    baseVol += row.b_share;
    newVol += row.n_share;
    baseVal += row.base_val_share ?? 0;
    newVal += row.value_share;
    newRev += row.revenue;
    if (row.r_index > 1e-9) {
      // R.Index is a ratio (new revenue / base revenue), same as the simulator grid.
      baseRev += row.revenue / row.r_index;
    }
  }
  return { baseVol, newVol, baseVal, newVal, baseRev, newRev };
}

interface OptTableRow {
  name: string;
  brand: string;
  /** Tier group the SKU belongs to; UNGROUPED_TIER when the study has no tier grouping. */
  tier: string;
  /** True when this decision SKU was price-optimized in the run. */
  optimized: boolean;
  /** Per-size-unit price when the SKU has a size; "—" otherwise. */
  currentText: string;
  /** Per-size-unit recommended price when the SKU has a size; "—" otherwise. */
  recText: string;
  /** Pack size (e.g. litres); null when the study has no size attribute. */
  size: number | null;
  /** Raw recommended price per size unit; null when size is unknown. */
  recPerUnit: number | null;
  /** Recommended €/L as % of the smallest pack in the same tier (100% = no volume discount). */
  discountText: string;
  packNote: string;
  unitPriceText: string;
  recUnitPriceText: string;
  baseVolShareText: string;
  newVolShareText: string;
  volShareGainText: string;
  revIndexText: string;
  /** Raw values for brand/tier aggregation. */
  volShareGain: number;
  baseVolShare: number;
  newVolShare: number;
  baseRev: number;
  newRev: number;
  limitedBy: string;
  conflict: boolean;
}

function formatVolShare(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return fmt(n, 2);
}

function formatVolShareGain(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${fmt(n, 2)}`;
}

function computeColumnSigma(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, v) => a + (v - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function volShareGainDeltaClass(gain: number, sigma: number): string {
  if (!Number.isFinite(gain) || sigma <= 0 || Math.abs(gain) < sigma) return "";
  return gain > 0 ? "delta-pos" : "delta-neg";
}

function formatRevIndex(baseRev: number, newRev: number): string {
  if (baseRev <= 1e-9) return "—";
  return fmt(newRev / baseRev, 2);
}

function revIndexValue(baseRev: number, newRev: number): number | null {
  if (baseRev <= 1e-9) return null;
  return newRev / baseRev;
}

/** Color when revenue index deviation from 1.0 is at least column sigma. */
function revIndexDeltaClass(index: number | null, sigma: number): string {
  if (index == null || !Number.isFinite(index) || sigma <= 0) return "";
  const delta = index - 1;
  if (Math.abs(delta) < sigma) return "";
  return delta > 0 ? "delta-pos" : "delta-neg";
}

function aggregateGroupMetrics(rows: OptTableRow[]): {
  volShareGain: number;
  baseVolShare: number;
  newVolShare: number;
  baseRev: number;
  newRev: number;
} {
  let volShareGain = 0;
  let baseVolShare = 0;
  let newVolShare = 0;
  let baseRev = 0;
  let newRev = 0;
  for (const row of rows) {
    volShareGain += row.volShareGain;
    baseVolShare += row.baseVolShare;
    newVolShare += row.newVolShare;
    baseRev += row.baseRev;
    newRev += row.newRev;
  }
  return { volShareGain, baseVolShare, newVolShare, baseRev, newRev };
}

function OptPriceCell({
  value,
  title,
  recommended,
  conflict,
  currencySymbol,
}: {
  value: string;
  title?: string;
  recommended?: boolean;
  conflict?: boolean;
  currencySymbol: string;
}) {
  if (value === "—") {
    return <span className="opt-price-cell muted">—</span>;
  }
  return (
    <span className={`opt-price-cell${recommended ? " recommended" : ""}`} title={title}>
      {currencySymbol}
      {value}
      {conflict && recommended ? " ⚠" : ""}
    </span>
  );
}

/** Bucket for SKUs the study's tier grouping doesn't cover (renders without a tier header). */
const UNGROUPED_TIER = "";

interface OptTableGroup {
  tier: string;
  rows: OptTableRow[];
}

interface OptTableBrandGroup {
  brand: string;
  tiers: OptTableGroup[];
}

/**
 * Brand → tier → SKU, keeping catalog order and each tier's first-seen position.
 * Rows arrive in study order, so tiers can interleave; this pulls them together
 * before rendering.
 */
function groupRows(rows: OptTableRow[]): OptTableBrandGroup[] {
  const out: OptTableBrandGroup[] = [];
  const byBrand = new Map<string, OptTableBrandGroup>();
  const byTier = new Map<string, OptTableGroup>();
  for (const row of rows) {
    let brandGroup = byBrand.get(row.brand);
    if (!brandGroup) {
      brandGroup = { brand: row.brand, tiers: [] };
      byBrand.set(row.brand, brandGroup);
      out.push(brandGroup);
    }
    const tierKey = `${row.brand}::${row.tier}`;
    let tierGroup = byTier.get(tierKey);
    if (!tierGroup) {
      tierGroup = { tier: row.tier, rows: [] };
      byTier.set(tierKey, tierGroup);
      brandGroup.tiers.push(tierGroup);
    }
    tierGroup.rows.push(row);
  }
  return out;
}

function flattenGroups(groups: OptTableBrandGroup[]): OptTableRow[] {
  return groups.flatMap((b) => b.tiers.flatMap((t) => t.rows));
}

function formatDiscountPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${Math.round(pct)}%`;
}

/** Index recommended €/L vs the smallest pack in each brand/tier group (smallest = 100%). */
function applyTierDiscountIndex(rows: OptTableRow[]): OptTableRow[] {
  if (rows.length === 0) return rows;

  const groups = new Map<string, OptTableRow[]>();
  for (const row of rows) {
    const key = `${row.brand}::${row.tier}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const discountBySku = new Map<string, number | null>();
  for (const groupRows of groups.values()) {
    const sized = groupRows.filter(
      (r) => r.size != null && r.size > 0 && r.recPerUnit != null && r.recPerUnit > 0,
    );
    if (sized.length === 0) continue;

    const smallest = sized.reduce((a, b) => (a.size! <= b.size! ? a : b));
    const baseline = smallest.recPerUnit!;
    for (const row of groupRows) {
      const key = `${row.brand}::${row.name}`;
      if (row.recPerUnit == null || row.recPerUnit <= 0 || baseline <= 0) {
        discountBySku.set(key, null);
      } else {
        discountBySku.set(key, (row.recPerUnit / baseline) * 100);
      }
    }
  }

  return rows.map((row) => {
    const pct = discountBySku.get(`${row.brand}::${row.name}`) ?? null;
    return { ...row, discountText: formatDiscountPct(pct) };
  });
}

function isStudyIncluded(sku: OptimizerBrandSku): boolean {
  return sku.included !== false;
}

function resultRowPrice(row: ResultRow): number {
  for (const key of ["New Price", "Base Price", "Price"] as const) {
    const raw = Number(row[key]);
    if (Number.isFinite(raw) && raw > 0) return raw;
  }
  return 0;
}

function skuFromResultRow(row: ResultRow, name: string): OptimizerBrandSku {
  const selected = row["Selected"];
  return {
    name,
    base_price: resultRowPrice(row),
    b_share: Number(row["B.Share"] ?? 0) || 0,
    n_share: Number(row["N.Share"] ?? 0) || 0,
    revenue: Number(row["Revenue"] ?? 0) || 0,
    value_share: Number(row["Value Share"] ?? 0) || 0,
    included: selected === false || selected === 0 ? false : true,
  };
}

/** Immediate SKU catalog from the live session so the list does not wait on brand-summary. */
function sessionSkusByBrand(
  results: ResultRow[] | undefined,
  groups: Record<string, string[]> | undefined,
): Record<string, OptimizerBrandSku[]> {
  const map: Record<string, OptimizerBrandSku[]> = {};
  if (!results?.length || !groups) return map;
  const byName = new Map(
    results.map((row) => [String(row["Product Name"] ?? ""), row] as const),
  );
  for (const [brand, names] of Object.entries(groups)) {
    map[brand] = names
      .map((name) => {
        const row = byName.get(name);
        return row ? skuFromResultRow(row, name) : null;
      })
      .filter((sku): sku is OptimizerBrandSku => sku != null);
  }
  return map;
}

function filterSkusToStandaloneOffers(
  skus: OptimizerBrandSku[],
  groupsByType: Record<string, Record<string, string[]>>,
): OptimizerBrandSku[] {
  if (skus.length === 0) return skus;
  const allowed = new Set(
    filterStandaloneOfferSkusFromMap(
      skus.map((s) => s.name),
      groupsByType,
    ),
  );
  return skus.filter((s) => allowed.has(s.name));
}

function mergeBrandSkus(
  sessionSkus: OptimizerBrandSku[],
  apiSkus: OptimizerBrandSku[] | undefined,
): OptimizerBrandSku[] {
  if (!apiSkus?.length) return sessionSkus;
  if (!sessionSkus.length) return apiSkus;
  const apiByName = new Map(apiSkus.map((sku) => [sku.name, sku]));
  const seen = new Set<string>();
  const merged = sessionSkus.map((sku) => {
    seen.add(sku.name);
    const api = apiByName.get(sku.name);
    if (!api) return sku;
    return {
      ...sku,
      size: api.size ?? sku.size,
      unit_cost: "unit_cost" in api ? api.unit_cost : sku.unit_cost,
    };
  });
  for (const api of apiSkus) {
    if (!seen.has(api.name)) merged.push(api);
  }
  return merged;
}

function highestShareSku(skus: OptimizerBrandSku[]): string | null {
  if (skus.length === 0) return null;
  return skus.reduce((best, s) => (s.n_share > best.n_share ? s : best), skus[0]).name;
}

function toProducts(brand: string, skus: OptimizerBrandSku[]): Product[] {
  return skus.map((s) => ({
    brand,
    name: s.name,
    bShare: s.n_share,
    basePrice: s.base_price,
    size: s.size != null && s.size > 0 ? s.size : null,
    unitCost:
      s.unit_cost != null && Number.isFinite(s.unit_cost) ? s.unit_cost : null,
    valueShare: s.value_share ?? 0,
    revenue: s.revenue,
  }));
}

function movesEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  }
  return true;
}

function toCompetitorMoves(moves: Record<string, number>): CompetitorMove[] {
  return Object.entries(moves)
    .filter(([, pct]) => pct !== 0)
    .map(([brand, pct]) => ({ brand, pct }));
}

/**
 * Of volume gained by other brands when the driver SKU price rises, each brand's share.
 * Cross-brand deltas are share fractions (already /100 vs base).
 */
function switchingSharesFromCrossBrand(
  data: CrossBrandData | null | undefined,
  focusBrand: string,
  scenarioKey: string = PRICE_SHOCK_SCENARIO_KEY,
): Record<string, number> {
  const deltas = data?.scenarios?.[scenarioKey];
  if (!deltas) return {};

  const gains: Record<string, number> = {};
  let sum = 0;
  for (const [brand, delta] of Object.entries(deltas)) {
    if (brand === focusBrand) continue;
    const g = Math.max(0, delta);
    if (g <= 0) continue;
    gains[brand] = g;
    sum += g;
  }
  if (sum <= 0) return {};

  const out: Record<string, number> = {};
  for (const [brand, g] of Object.entries(gains)) {
    out[brand] = (g / sum) * 100;
  }
  return out;
}

/** Of volume gained by competitor SKUs when the driver SKU price rises, each SKU's share. */
function switchingSharesFromCrossBrandSku(
  data: CrossBrandData | null | undefined,
  excludeSkus: Set<string>,
  scenarioKey: string = PRICE_SHOCK_SCENARIO_KEY,
): Record<string, number> {
  const deltas = data?.scenarios?.[scenarioKey];
  if (!deltas) return {};

  const gains: Record<string, number> = {};
  let sum = 0;
  for (const [sku, delta] of Object.entries(deltas)) {
    if (excludeSkus.has(sku)) continue;
    const g = Math.max(0, delta);
    if (g <= 0) continue;
    gains[sku] = g;
    sum += g;
  }
  if (sum <= 0) return {};

  const out: Record<string, number> = {};
  for (const [sku, g] of Object.entries(gains)) {
    out[sku] = (g / sum) * 100;
  }
  return out;
}

/**
 * Competitor expected-move starting scenario for recommendations.
 * Disabled for now — hide the panel and omit moves from corridor/run inputs.
 */
const COMPETITIVE_MOVES_ENABLED = false;
const EMPTY_COMP_MOVES: Record<string, number> = {};

interface AnchorSkuOption {
  name: string;
  share: number;
  price: number;
}

interface AnchorBrandCandidate {
  brand: string;
  share: number;
  anchorSku: string;
  anchorPrice: number;
  skus: AnchorSkuOption[];
  isOwn: boolean;
}

const TOP_SWITCHING_ROWS = 3;

/** Keep the top N brands; fold the rest into a single Other bucket. */
function collapseSwitchingRows(rows: AnchorBrandCandidate[], topN = TOP_SWITCHING_ROWS): {
  top: AnchorBrandCandidate[];
  other: { share: number; brands: AnchorBrandCandidate[] } | null;
} {
  if (rows.length <= topN) return { top: rows, other: null };
  const top = rows.slice(0, topN);
  const brands = rows.slice(topN);
  return {
    top,
    other: { share: brands.reduce((s, c) => s + c.share, 0), brands },
  };
}

function brandPriceIndex(
  candidate: AnchorBrandCandidate,
  focusRefPrice: number,
  movePct: number,
): number {
  const moved = candidate.anchorPrice * (1 + movePct / 100);
  return moved > 0 ? Math.round((focusRefPrice / moved) * 100) : 0;
}

function otherPriceIndex(
  brands: AnchorBrandCandidate[],
  focusRefPrice: number,
  moves: Record<string, number>,
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const c of brands) {
    const idx = brandPriceIndex(c, focusRefPrice, moves[c.brand] ?? 0);
    if (c.share > 0) {
      weighted += idx * c.share;
      weight += c.share;
    }
  }
  return weight > 0 ? Math.round(weighted / weight) : null;
}

const REF_SKU_SERIES = [
  { key: "volIx", label: "Volume Ix", short: "Volume Ix", yAxisId: "index", color: "#5C6B80", dash: undefined as string | undefined, width: 2, unit: "idx" },
  { key: "revIx", label: "Revenue Ix", short: "Revenue Ix", yAxisId: "index", color: "#002D62", dash: undefined as string | undefined, width: 2, unit: "idx" },
  { key: "marginIx", label: "Sales Margin Ix", short: "Margin Ix", yAxisId: "index", color: "#C41230", dash: undefined as string | undefined, width: 2, unit: "idx" },
  { key: "marginPct", label: "Sales Margin %", short: "Margin %", yAxisId: "margin", color: "#C41230", dash: "5 4", width: 1.5, unit: "%" },
] as const;

type RefSkuSeriesKey = (typeof REF_SKU_SERIES)[number]["key"];

function indexVsBase(value: number, base: number): number {
  return base > 0 ? (value / base) * 100 : 0;
}

function axisTicks(min: number, max: number, include?: number, maxTicks = 6): number[] {
  const lo = include == null ? min : Math.min(min, include);
  const hi = include == null ? max : Math.max(max, include);
  const span = Math.max(1, hi - lo);
  const rawStep = span / Math.max(1, maxTicks - 1);
  const bases = [5, 10, 20, 25, 50];
  let step = 500;
  let found = false;
  for (let mag = 1; mag <= 1000000; mag *= 10) {
    for (const b of bases) {
      const s = b * mag;
      if (s >= rawStep) {
        step = s;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= end + 1e-9; t += step) ticks.push(t);
  if (include != null && !ticks.some((t) => Math.abs(t - include) < 1e-9)) {
    ticks.push(include);
    ticks.sort((a, b) => a - b);
  }
  return ticks;
}

function priceAxisTicks(lo: number, hi: number, extra: number[] = []): number[] {
  const span = Math.max(0.2, hi - lo);
  const rawStep = span / 12;
  const bases = [0.05, 0.1, 0.2, 0.25, 0.5];
  let step = 1;
  let found = false;
  for (let mag = 1; mag <= 10000; mag *= 10) {
    for (const b of bases) {
      const s = b * mag;
      if (s >= rawStep) {
        step = s;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  const start = Math.ceil(lo / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = start; t <= hi + step * 1e-6; t += step) {
    const v = Math.round(t * 100) / 100;
    if (v >= lo - 1e-6 && v <= hi + 1e-6) ticks.push(v);
  }
  for (const edge of [lo, hi, ...extra]) {
    const v = Math.round(edge * 100) / 100;
    if (v < lo - 1e-6 || v > hi + 1e-6) continue;
    if (!ticks.some((t) => Math.abs(t - v) < step * 0.35)) ticks.push(v);
  }
  ticks.sort((a, b) => a - b);
  return ticks;
}

function interpolatePriceAt(
  points: { price: number; value: number | null }[],
  target: number,
  opts?: { minPrice?: number | null; maxPrice?: number | null },
): number | null {
  const sorted = [...points]
    .filter((p) => p.value != null && Number.isFinite(p.value) && p.price > 0)
    .sort((a, b) => a.price - b.price);
  for (let i = 1; i < sorted.length; i++) {
    const y0 = sorted[i - 1].value as number;
    const y1 = sorted[i].value as number;
    if ((y0 - target) * (y1 - target) > 0) continue;
    if (Math.abs(y1 - y0) < 1e-12) continue;
    const x =
      sorted[i - 1].price +
      ((target - y0) / (y1 - y0)) * (sorted[i].price - sorted[i - 1].price);
    if (opts?.minPrice != null && x < opts.minPrice - 1e-6) continue;
    if (opts?.maxPrice != null && x > opts.maxPrice + 1e-6) continue;
    return x;
  }
  return null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleRowAtPrice<
  T extends {
    price: number;
    volIx: number;
    revIx: number;
    marginIx: number;
    marginPct: number | null;
    isCurrent: boolean;
  },
>(sorted: T[], x: number): T | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return { ...sorted[0], price: x, isCurrent: false };
  if (x <= sorted[0].price) return { ...sorted[0], price: x, isCurrent: false };
  const last = sorted[sorted.length - 1];
  if (x >= last.price) return { ...last, price: x, isCurrent: false };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (x > b.price) continue;
    const t = (x - a.price) / (b.price - a.price || 1);
    const m0 = a.marginPct;
    const m1 = b.marginPct;
    return {
      ...a,
      price: x,
      volIx: lerp(a.volIx, b.volIx, t),
      revIx: lerp(a.revIx, b.revIx, t),
      marginIx: lerp(a.marginIx, b.marginIx, t),
      marginPct: m0 != null && m1 != null ? lerp(m0, m1, t) : (m0 ?? m1),
      isCurrent: false,
    };
  }
  return null;
}

function finitePrice(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

function toCorridorBound(pt: CorridorPreviewPoint): CorridorPreviewBound {
  return {
    index: pt.index,
    price: pt.price,
    brand_cm_pct: pt.brand_cm_pct,
    ref_sku_cm_pct: pt.ref_sku_cm_pct,
    ref_sku_contribution: pt.ref_sku_contribution,
    ref_sku_contribution_index: pt.ref_sku_contribution_index,
    brand_volume_drop_pct: pt.brand_volume_drop_pct,
    ref_sku_volume_drop_pct: pt.ref_sku_volume_drop_pct,
    brand_contribution: pt.brand_contribution,
  };
}

function interpolateCorridorBoundAt(
  points: CorridorPreviewPoint[],
  price: number,
  indexAnchorPrice: number,
): CorridorPreviewBound | null {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  if (sorted.length === 0) return null;
  const index = indexAnchorPrice > 0 ? (price / indexAnchorPrice) * 100 : 0;
  if (price <= sorted[0].price) {
    return { ...toCorridorBound(sorted[0]), price, index };
  }
  const last = sorted[sorted.length - 1];
  if (price >= last.price) {
    return { ...toCorridorBound(last), price, index };
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (price > b.price) continue;
    const t = (price - a.price) / (b.price - a.price || 1);
    const lerpNullable = (x: number | null, y: number | null) =>
      x != null && y != null ? lerp(x, y, t) : x ?? y;
    return {
      index,
      price,
      brand_cm_pct: lerp(a.brand_cm_pct, b.brand_cm_pct, t),
      ref_sku_cm_pct: lerpNullable(a.ref_sku_cm_pct, b.ref_sku_cm_pct),
      ref_sku_contribution: lerp(a.ref_sku_contribution, b.ref_sku_contribution, t),
      ref_sku_contribution_index: lerp(
        a.ref_sku_contribution_index,
        b.ref_sku_contribution_index,
        t,
      ),
      brand_volume_drop_pct: lerp(a.brand_volume_drop_pct, b.brand_volume_drop_pct, t),
      ref_sku_volume_drop_pct: lerp(
        a.ref_sku_volume_drop_pct,
        b.ref_sku_volume_drop_pct,
        t,
      ),
      brand_contribution: lerp(a.brand_contribution, b.brand_contribution, t),
    };
  }
  return null;
}

function marginFloorPriceFromCost(cost: number | null, marginFloorPct: number, priceLo: number) {
  let marginFloorPrice = priceLo;
  let minBindingLabel = "calibrated price floor";
  if (cost != null && cost > 0 && marginFloorPct < 100 - 1e-9) {
    const solved = cost / (1 - marginFloorPct / 100);
    if (Number.isFinite(solved)) {
      marginFloorPrice = Math.max(priceLo, solved);
      if (solved > priceLo + 1e-12) minBindingLabel = "min contribution margin";
    }
  }
  const minPrice = Math.ceil(marginFloorPrice * 100 - 1e-9) / 100;
  return { minPrice, minBindingLabel, marginFloorPrice: minPrice };
}

/** Re-derive corridor edges from an existing sweep — no share re-simulation needed. */
function deriveCorridorBounds(
  points: CorridorPreviewPoint[],
  opts: {
    marginFloorPct: number;
    volumeCapPct: number;
    refCost: number | null;
    priceLo: number;
    priceHi: number;
    indexAnchorPrice: number;
  },
): {
  min: CorridorPreviewBound | null;
  max: CorridorPreviewBound | null;
  recommended: CorridorPreviewBound | null;
  min_binding_label: string;
  max_binding_label: string;
  binding_label: string;
  feasible_count: number;
  margin_floor_price: number | null;
} {
  const empty = {
    min: null,
    max: null,
    recommended: null,
    min_binding_label: "infeasible",
    max_binding_label: "infeasible",
    binding_label: "infeasible",
    feasible_count: 0,
    margin_floor_price: null as number | null,
  };
  if (points.length === 0) return empty;

  const { minPrice, minBindingLabel, marginFloorPrice } = marginFloorPriceFromCost(
    opts.refCost,
    opts.marginFloorPct,
    opts.priceLo,
  );

  const feasibleCount = points.filter((p) => {
    const cmOk =
      p.ref_sku_cm_pct != null && p.ref_sku_cm_pct + 1e-9 >= opts.marginFloorPct;
    const volOk = p.brand_volume_drop_pct <= opts.volumeCapPct + 1e-9;
    return cmOk && volOk;
  }).length;

  const leastBad = (): CorridorPreviewBound => {
    let best = toCorridorBound(points[0]);
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (const p of points) {
      const cmGap =
        p.ref_sku_cm_pct != null
          ? Math.max(0, opts.marginFloorPct - p.ref_sku_cm_pct)
          : opts.marginFloorPct;
      const volGap = Math.max(0, p.brand_volume_drop_pct - opts.volumeCapPct);
      const penalty = cmGap + volGap;
      if (
        penalty < bestPenalty - 1e-9 ||
        (Math.abs(penalty - bestPenalty) <= 1e-9 &&
          p.ref_sku_contribution > best.ref_sku_contribution)
      ) {
        bestPenalty = penalty;
        best = toCorridorBound(p);
      }
    }
    return best;
  };

  if (minPrice > opts.priceHi + 1e-9) {
    const fallback = leastBad();
    return {
      ...empty,
      min: fallback,
      max: fallback,
      recommended: fallback,
      margin_floor_price: marginFloorPrice,
    };
  }

  const minPt = interpolateCorridorBoundAt(points, minPrice, opts.indexAnchorPrice);
  if (!minPt) return empty;

  const ceilingPt = interpolateCorridorBoundAt(points, opts.priceHi, opts.indexAnchorPrice);
  let maxPt = ceilingPt;
  let maxBindingLabel = "calibrated price ceiling";
  if (ceilingPt && ceilingPt.brand_volume_drop_pct > opts.volumeCapPct + 1e-9) {
    const volCapX = interpolatePriceAt(
      points.map((p) => ({ price: p.price, value: p.brand_volume_drop_pct })),
      opts.volumeCapPct,
      { minPrice },
    );
    if (volCapX != null) {
      maxPt = interpolateCorridorBoundAt(points, volCapX, opts.indexAnchorPrice);
      maxBindingLabel = "max volume drop";
    }
  }

  const bandLo = minPrice;
  const bandHi = maxPt?.price ?? opts.priceHi;
  let recPt = minPt;
  if (bandHi - bandLo > 0.01) {
    const step = Math.max(0.01, (bandHi - bandLo) / 24);
    const scanPrices: number[] = [];
    // Ensure we don't generate too many points if bandHi is very large
    const maxSteps = 1000;
    const actualStep = Math.max(step, (bandHi - bandLo) / maxSteps);
    for (let p = bandLo; p <= bandHi + 1e-9; p += actualStep) scanPrices.push(p);
    if (scanPrices[scanPrices.length - 1] < bandHi - 1e-9) scanPrices.push(bandHi);
    for (const p of scanPrices) {
      const pt = interpolateCorridorBoundAt(points, p, opts.indexAnchorPrice);
      if (pt && pt.ref_sku_contribution > recPt.ref_sku_contribution) recPt = pt;
    }
    for (const p of points) {
      if (
        p.price >= bandLo - 1e-9 &&
        p.price <= bandHi + 1e-9 &&
        p.ref_sku_contribution > recPt.ref_sku_contribution
      ) {
        recPt = toCorridorBound(p);
      }
    }
  }

  return {
    min: minPt,
    max: maxPt,
    recommended: recPt,
    min_binding_label: minBindingLabel,
    max_binding_label: maxBindingLabel,
    binding_label: maxBindingLabel,
    feasible_count: feasibleCount,
    margin_floor_price: marginFloorPrice,
  };
}

function priceToAnchorIndex(price: number, anchorPrice: number | null | undefined): number | null {
  if (anchorPrice == null || !Number.isFinite(anchorPrice) || anchorPrice <= 0) return null;
  return (price / anchorPrice) * 100;
}

function formatAnchorIndex(price: number, anchorPrice: number | null | undefined): string {
  const ix = priceToAnchorIndex(price, anchorPrice);
  return ix != null ? ix.toFixed(0) : "—";
}

function OptPriceIndexAxisTick({
  x = 0,
  y = 0,
  payload,
  anchorPrice,
  currencySymbol,
}: {
  x?: string | number;
  y?: string | number;
  payload?: { value?: number };
  anchorPrice?: number | null;
  currencySymbol: string;
}) {
  const price = Number(payload?.value ?? 0);
  const anchorIx = priceToAnchorIndex(price, anchorPrice);
  return (
    <g transform={`translate(${Number(x)},${Number(y)})`}>
      <text y={0} dy={12} textAnchor="middle" fill="#5c6570" fontSize={9}>
        {currencySymbol}
        {price.toFixed(2)}
      </text>
      {anchorIx != null ? (
        <text y={0} dy={24} textAnchor="middle" fill="#5C6B80" fontSize={8}>
          {anchorIx.toFixed(0)}
        </text>
      ) : null}
    </g>
  );
}

/** Marker name drawn above the plot (outside the data area). */
function OptPriceMarkerLabel({
  viewBox,
  label,
  color,
  emphasize,
  stackIndex = 0,
}: {
  viewBox?: { x?: number; y?: number };
  label: string;
  color: string;
  emphasize?: boolean;
  stackIndex?: number;
}) {
  const x = viewBox?.x ?? 0;
  // Sit just above the plot top; stack upward when markers are close.
  const y = (viewBox?.y ?? 0) - 6 - stackIndex * 13;
  const fontSize = emphasize ? 11 : 10;
  const fontWeight = emphasize ? 800 : 700;
  return (
    <g transform={`translate(${x},${y})`} style={{ pointerEvents: "none" }}>
      <text
        textAnchor="middle"
        dominantBaseline="auto"
        fill={color}
        fontSize={fontSize}
        fontWeight={fontWeight}
        letterSpacing={emphasize ? "0.02em" : undefined}
      >
        {label}
      </text>
    </g>
  );
}

function OptRefSkuResponseChart({
  points,
  baseline,
  anchorPrice,
  anchorLabel,
  anchorSku,
  marginFloorPrice,
  volumeCapPrice,
  marginFloorPct,
  volumeCapPct,
  currencySymbol,
}: {
  points: CorridorPreviewPoint[];
  baseline?: Record<string, number | null>;
  anchorPrice?: number | null;
  anchorLabel?: string | null;
  anchorSku?: string | null;
  marginFloorPrice?: number | null;
  volumeCapPrice?: number | null;
  marginFloorPct?: number;
  volumeCapPct?: number;
  currencySymbol: string;
}) {
  const [visible, setVisible] = useState<Record<RefSkuSeriesKey, boolean>>({
    volIx: true,
    revIx: true,
    marginIx: true,
    marginPct: true,
  });

  const baseVol = Number(baseline?.reference_sku_volume ?? 0);
  const baseCm = Number(baseline?.reference_sku_cm_pct ?? 0);
  const baseContrib = Number(baseline?.reference_sku_contribution ?? 0);
  const baseRev =
    Number(baseline?.reference_sku_revenue ?? 0) ||
    (Math.abs(baseCm) > 1e-9 ? baseContrib / (baseCm / 100) : 0);

  const data = points.map((p) => {
    const cm = p.ref_sku_cm_pct;
    const revenue =
      p.ref_sku_revenue ??
      (cm != null && Math.abs(cm) > 1e-9
        ? p.ref_sku_contribution / (cm / 100)
        : p.price * p.ref_sku_volume);
    const volIx = Number(
      (p.ref_sku_volume_index ?? indexVsBase(p.ref_sku_volume, baseVol)).toFixed(1),
    );
    const revIx = Number(
      (p.ref_sku_revenue_index ?? indexVsBase(revenue, baseRev)).toFixed(1),
    );
    const marginIx = Number(
      (p.ref_sku_margin_index ?? p.ref_sku_contribution_index).toFixed(1),
    );
    const isCurrent =
      Boolean(p.is_current) ||
      (Number(baseline?.reference_sku_price ?? 0) > 0 &&
        Math.abs(p.price - Number(baseline?.reference_sku_price ?? 0)) <= 0.005);
    return {
      price: p.price,
      label: `${currencySymbol}${p.price.toFixed(2)}`,
      volIx: isCurrent ? 100 : volIx,
      revIx: isCurrent ? 100 : revIx,
      marginIx: isCurrent ? 100 : marginIx,
      marginPct: cm != null && Number.isFinite(cm) ? Number(cm.toFixed(1)) : null,
      isCurrent,
    };
  });

  const seriesMeta: Record<string, { short: string; unit: string }> = Object.fromEntries(
    REF_SKU_SERIES.map((s) => [s.label, { short: s.short, unit: s.unit }]),
  );
  const currentPrice =
    finitePrice(data.find((d) => d.isCurrent)?.price) ??
    finitePrice(Number(baseline?.reference_sku_price ?? 0));
  const cmFloorX =
    finitePrice(marginFloorPrice) ??
    interpolatePriceAt(
      points.map((p) => ({ price: p.price, value: p.ref_sku_cm_pct })),
      marginFloorPct ?? NaN,
      { maxPrice: currentPrice },
    );
  const volCapX = interpolatePriceAt(
    points.map((p) => ({ price: p.price, value: p.brand_volume_drop_pct })),
    volumeCapPct ?? NaN,
    { minPrice: currentPrice },
  ) ?? (
    finitePrice(volumeCapPrice) != null &&
    currentPrice != null &&
    volumeCapPrice! > currentPrice + 0.02
      ? volumeCapPrice!
      : null
  );

  const priceMarkers = [
    cmFloorX != null
      ? {
          key: "margin",
          role: "guardrail" as const,
          x: cmFloorX,
          shortLabel: "Min CM",
          color: "#C41230",
        }
      : null,
    currentPrice != null
      ? {
          key: "current",
          role: "current" as const,
          x: currentPrice,
          shortLabel: "Current",
          color: "#3d4450",
        }
      : null,
    volCapX != null
      ? {
          key: "volume",
          role: "guardrail" as const,
          x: volCapX,
          shortLabel: "Max vol drop",
          color: "#002D62",
        }
      : null,
  ].filter((m): m is NonNullable<typeof m> => m != null);

  const markerLabelStack = (() => {
    const byX = [...priceMarkers].sort((a, b) => a.x - b.x);
    const stack: Record<string, number> = {};
    let run = 0;
    for (let i = 0; i < byX.length; i++) {
      if (i > 0 && Math.abs(byX[i].x - byX[i - 1].x) < 0.35) run += 1;
      else run = 0;
      stack[byX[i].key] = run;
    }
    return stack;
  })();
  const markerLabelTopPad =
    priceMarkers.length > 0
      ? 16 + (Math.max(0, ...Object.values(markerLabelStack)) + 1) * 13
      : 8;

  const dataPrices = data.map((d) => d.price).filter((n) => n > 0);
  const dataMin = dataPrices.length ? Math.min(...dataPrices) : 0;
  const dataMax = dataPrices.length ? Math.max(...dataPrices) : 1;
  const floorLo = cmFloorX ?? currentPrice ?? dataMin;
  const floorHi = volCapX ?? currentPrice ?? dataMax;
  let zoomLo = Math.min(floorLo, currentPrice ?? floorLo, floorHi);
  let zoomHi = Math.max(floorLo, currentPrice ?? floorHi, floorHi);
  if (zoomHi - zoomLo < 0.1) {
    const mid = (zoomLo + zoomHi) / 2;
    zoomLo = mid - 0.4;
    zoomHi = mid + 0.4;
  }
  const xPad = Math.max(0.12, (zoomHi - zoomLo) * 0.15);
  const xDomain: [number, number] = [
    Math.max(dataMin, zoomLo - xPad),
    Math.min(dataMax, zoomHi + xPad),
  ];

  const windowed = data.filter((d) => d.price >= xDomain[0] && d.price <= xDomain[1]);
  const floorRows = data.filter((d) => d.price >= zoomLo && d.price <= zoomHi);
  const yRows = (floorRows.length > 0 ? floorRows : windowed.length > 0 ? windowed : data);
  const sorted = [...data].sort((a, b) => a.price - b.price);
  const leftPad = [...sorted].reverse().find((d) => d.price < xDomain[0]);
  const rightPad = sorted.find((d) => d.price > xDomain[1]);
  const plotRows = [
    ...(leftPad ? [leftPad] : []),
    ...(windowed.length > 0 ? windowed : sorted),
    ...(rightPad ? [rightPad] : []),
  ];
  const xTicks = priceAxisTicks(xDomain[0], xDomain[1]);
  const measured = [...plotRows].sort((a, b) => a.price - b.price);
  const hoverLo = measured[0]?.price ?? xDomain[0];
  const hoverHi = measured[measured.length - 1]?.price ?? xDomain[1];
  const hoverXs = new Set<number>();
  for (const t of xTicks) {
    if (t >= hoverLo - 1e-9 && t <= hoverHi + 1e-9) {
      hoverXs.add(Math.round(t * 100) / 100);
    }
  }
  const hoverRangeCents = Math.max(0, Math.round((hoverHi - hoverLo) * 100));
  const stepCents = Math.max(1, Math.ceil(hoverRangeCents / 250));
  for (let p = Math.round(hoverLo * 100); p <= Math.round(hoverHi * 100); p += stepCents) {
    const v = p / 100;
    if (v >= xDomain[0] - 1e-9 && v <= xDomain[1] + 1e-9) hoverXs.add(v);
  }
  for (const r of measured) hoverXs.add(Math.round(r.price * 100) / 100);
  for (const m of priceMarkers) {
    if (m.x >= hoverLo - 1e-9 && m.x <= hoverHi + 1e-9) {
      hoverXs.add(Math.round(m.x * 100) / 100);
    }
  }
  const hoverRows = [...hoverXs]
    .sort((a, b) => a - b)
    .map((x) => {
      const exact = measured.find((r) => Math.abs(r.price - x) < 0.005);
      return exact ?? sampleRowAtPrice(measured, x);
    })
    .filter((r): r is NonNullable<typeof r> => r != null);
  const idxVals = yRows.flatMap((d) => [d.volIx, d.revIx, d.marginIx]);
  const idxTicks = axisTicks(Math.min(...idxVals), Math.max(...idxVals), 100);
  const idxDomain: [number, number] = [idxTicks[0], idxTicks[idxTicks.length - 1]];

  const marginVals = yRows
    .map((d) => d.marginPct)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const marginTicks = axisTicks(
    marginVals.length ? Math.min(...marginVals) : 0,
    marginVals.length ? Math.max(...marginVals) : 100,
  );
  const marginDomain: [number, number] = [marginTicks[0], marginTicks[marginTicks.length - 1]];
  const anchorIxHint =
    anchorLabel != null && anchorLabel !== ""
      ? `Index vs ${anchorLabel}${anchorSku ? ` (${anchorSku})` : ""}`
      : "Index vs anchor";

  return (
    <div className="opt-chart-block">
      <div className="opt-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={hoverRows}
            margin={{ top: markerLabelTopPad, right: 10, left: 4, bottom: 24 }}
          >
            <CartesianGrid stroke="#d8dee8" vertical={false} />
            <XAxis
              dataKey="price"
              type="number"
              domain={xDomain}
              allowDataOverflow
              ticks={xTicks}
              interval={0}
              height={44}
              tick={(props) => (
                <OptPriceIndexAxisTick
                  {...props}
                  anchorPrice={anchorPrice}
                  currencySymbol={currencySymbol}
                />
              )}
              label={{
                value: `${anchorIxHint} · 100 = parity at anchor price`,
                position: "insideBottom",
                offset: -6,
                style: { fontSize: 9, fill: "#5C6B80", textAnchor: "middle" },
              }}
            />
            <YAxis
              yAxisId="index"
              tick={{ fontSize: 10 }}
              domain={idxDomain}
              ticks={idxTicks}
              allowDataOverflow
              allowDecimals={false}
              label={{
                value: "Index",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 10 },
              }}
            />
            <YAxis
              yAxisId="margin"
              orientation="right"
              tick={{ fontSize: 10 }}
              domain={marginDomain}
              ticks={marginTicks}
              allowDataOverflow
              allowDecimals={false}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
              label={{
                value: "Sales Margin %",
                angle: 90,
                position: "insideRight",
                style: { fontSize: 10 },
              }}
            />
            <ReferenceLine
              yAxisId="index"
              y={100}
              stroke="#b8c0cc"
              strokeDasharray="4 4"
            />
            {priceMarkers.map((m) => (
              <ReferenceLine
                key={m.key}
                yAxisId="index"
                x={m.x}
                stroke={m.color}
                strokeWidth={m.role === "current" ? 2 : 1.5}
                strokeDasharray={m.role === "current" ? "5 3" : "3 3"}
                label={(props) => (
                  <OptPriceMarkerLabel
                    viewBox={props.viewBox as { x?: number; y?: number } | undefined}
                    label={m.shortLabel}
                    color={m.color}
                    emphasize={m.role === "current"}
                    stackIndex={markerLabelStack[m.key] ?? 0}
                  />
                )}
              />
            ))}
            {currentPrice != null ? (
              <ReferenceDot
                yAxisId="index"
                x={currentPrice}
                y={100}
                r={5}
                fill="#3d4450"
                stroke="#fff"
                strokeWidth={1.5}
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: "#5C6B80", strokeDasharray: "3 3" }}
              isAnimationActive={false}
              contentStyle={{
                fontSize: 11,
                lineHeight: 1.25,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                boxShadow: "none",
                maxWidth: 220,
              }}
              labelStyle={{ fontWeight: 600, marginBottom: 2, fontSize: 11 }}
              itemStyle={{ padding: 0, margin: 0 }}
              labelFormatter={(label) => {
                const price = Number(label);
                const anchorIx = priceToAnchorIndex(price, anchorPrice);
                const bits = [`${currencySymbol}${price.toFixed(2)}`];
                if (anchorIx != null) {
                  bits.push(
                    anchorLabel
                      ? `${anchorIxHint} ${anchorIx.toFixed(0)}`
                      : `index vs anchor ${anchorIx.toFixed(0)}`,
                  );
                }
                if (currentPrice != null && Math.abs(price - currentPrice) < 0.03) {
                  bits.push("current (index 100)");
                }
                if (cmFloorX != null && Math.abs(price - cmFloorX) < 0.03) {
                  bits.push(`min CM ${marginFloorPct}%`);
                }
                if (volCapX != null && Math.abs(price - volCapX) < 0.03) {
                  bits.push(`max vol drop ${volumeCapPct}%`);
                }
                return bits.join(" · ");
              }}
              formatter={(value, name) => {
                const n = typeof value === "number" ? value : Number(value);
                const meta = seriesMeta[String(name)];
                const text = !Number.isFinite(n)
                  ? "—"
                  : meta?.unit === "%"
                    ? `${n.toFixed(1)}%`
                    : n.toFixed(1);
                return [text, meta?.short ?? String(name)];
              }}
            />
            {REF_SKU_SERIES.filter((s) => visible[s.key]).map((s) => (
              <Line
                key={s.key}
                yAxisId={s.yAxisId}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeDasharray={s.dash}
                strokeWidth={s.width}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 1 }}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="opt-chart-toggles" role="group" aria-label="Reference SKU series">
        {REF_SKU_SERIES.map((s) => (
          <label key={s.key} className="opt-chart-toggle">
            <input
              type="checkbox"
              checked={visible[s.key]}
              onChange={() =>
                setVisible((prev) => ({ ...prev, [s.key]: !prev[s.key] }))
              }
            />
            <span
              className={`opt-chart-swatch${s.dash ? " is-dashed" : ""}`}
              style={s.dash ? { color: s.color } : { background: s.color }}
            />
            <span style={{ color: s.color }}>{s.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function OptimizerPage() {
  const { session, setSession } = useSession();
  const display = useStudyDisplay();
  const slug = session?.slug;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pageActive = usePageActive();
  const applyScenario = useApplyScenario();

  const [groupType, setGroupType] = useState("");
  const [focusBrand, setFocusBrandState] = useState("");
  const [objective, setObjective] = useState<Objective>("Margin");
  const [anchorIdx, setAnchorIdx] = useState(0);
  const [anchorSkuByBrand, setAnchorSkuByBrand] = useState<Record<string, string>>({});
  const [expandedAnchorBrands, setExpandedAnchorBrands] = useState<Record<string, boolean>>({});

  const [marginFloor, setMarginFloor] = useState(34);
  const [shareLossLimit, setShareLossLimit] = useState(10);

  const [optSelectedSkus, setOptSelectedSkus] = useState<Record<string, boolean>>({});
  const [referenceSkuByBrand, setReferenceSkuByBrand] = useState<Record<string, string>>({});

  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ evals: number; estimated: number } | null>(
    null,
  );
  const [runResult, setRunResult] = useState<OptimizerRunResult | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [openingSimulator, setOpeningSimulator] = useState(false);
  const [openSimError, setOpenSimError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRunDebug, setLastRunDebug] = useState<{
    request: RunOptimizerRequest;
    ui: Record<string, unknown>;
  } | null>(null);
  const [compareScope, setCompareScope] = useState<CompareScope>("brand");
  const [compMoves, setCompMoves] = useState<Record<string, number>>({});
  const [appliedCompMoves, setAppliedCompMoves] = useState<Record<string, number>>({});
  const [reactionMoves, setReactionMoves] = useState<Record<string, number>>({});
  const [reactionError, setReactionError] = useState<string | null>(null);

  // Optimizer always starts from study base prices — ignore the Simulator's active scenario.
  const setup = useMemo(
    () => buildOptimizerSetup(session?.segmentation, null),
    [session?.segmentation],
  );

  const { data: validationSeries } = useValidationSeries(slug);
  const recommendationConfidence = useMemo(() => {
    const points = validationSeries?.points ?? [];
    if (!points.length) return null;
    const latest = points[points.length - 1];
    return getRecommendationConfidence(validationScoreFromWavePoint(latest));
  }, [validationSeries]);

  const {
    data: context,
    isLoading: contextLoading,
    isError: contextError,
    error: contextErr,
  } = useOptimizerContext(slug, { enabled: pageActive });

  const ownSet = useMemo(
    () => new Set(session?.companyProducts ?? []),
    [session?.companyProducts],
  );

  useEffect(() => {
    if (!context) return;
    const nextGroup =
      groupType && context.group_types.includes(groupType)
        ? groupType
        : context.default_group_type || context.group_types[0] || "";
    if (nextGroup !== groupType) setGroupType(nextGroup);

    const allBrands = context.groups_by_type[nextGroup] ?? {};
    const filtered =
      ownSet.size > 0
        ? Object.keys(allBrands).filter((b) => allBrands[b].some((s) => ownSet.has(s)))
        : Object.keys(allBrands);
    if (filtered.length === 0) {
      if (focusBrand) setFocusBrandState("");
      return;
    }
    if (!focusBrand || !filtered.includes(focusBrand)) {
      setFocusBrandState(filtered[0]);
    }
  }, [context, groupType, focusBrand, ownSet]);

  const allGroupBrands = useMemo(() => {
    if (!context || !groupType) return [] as string[];
    return Object.keys(context.groups_by_type[groupType] ?? {});
  }, [context, groupType]);

  const brands = useMemo(() => {
    if (ownSet.size === 0) return allGroupBrands;
    return allGroupBrands.filter((brand) => {
      const skus = context?.groups_by_type[groupType]?.[brand] ?? [];
      return skus.some((sku) => ownSet.has(sku));
    });
  }, [allGroupBrands, context, groupType, ownSet]);

  const {
    data: brandSummaryMap,
    isLoading: summariesQueryLoading,
    isError: summaryError,
    error: summaryErr,
  } = useOptimizerBrandSummaries(slug, groupType || undefined, setup, {
    enabled: pageActive,
  });
  const { data: skuBounds = [] } = useOptimizerBounds(
    slug,
    groupType || undefined,
    focusBrand || undefined,
    setup,
    { enabled: pageActive && Boolean(slug && groupType && focusBrand) },
  );

  // Only seed from the live session when it is Base; a named Simulator scenario
  // would paint the wrong prices while brand-summaries load study base.
  const groupsByTypeMap = useMemo(
    () => context?.groups_by_type ?? {},
    [context?.groups_by_type],
  );

  const seededSkusByBrand = useMemo(
    () =>
      session?.scenarioName
        ? {}
        : sessionSkusByBrand(
            session?.results,
            groupType ? context?.groups_by_type[groupType] : undefined,
          ),
    [session?.scenarioName, session?.results, context, groupType],
  );

  const skusByBrand = useMemo(() => {
    const map: Record<string, OptimizerBrandSku[]> = {};
    for (const brand of allGroupBrands) {
      const merged = mergeBrandSkus(
        seededSkusByBrand[brand] ?? [],
        brandSummaryMap?.brands?.[brand]?.skus,
      );
      map[brand] = filterSkusToStandaloneOffers(merged, groupsByTypeMap);
    }
    return map;
  }, [allGroupBrands, seededSkusByBrand, brandSummaryMap, groupsByTypeMap]);

  // The study's tier grouping (falls back to any non-brand grouping) gives the
  // middle level of the results table: brand → tier → SKU.
  const tierGroupType = useMemo(() => {
    const types = context?.group_types ?? [];
    return (
      types.find((t) => t.toLowerCase().includes("tier")) ??
      types.find((t) => t !== groupType) ??
      null
    );
  }, [context, groupType]);

  const tierBySku = useMemo(() => {
    const map: Record<string, string> = {};
    if (!tierGroupType) return map;
    const groups = context?.groups_by_type[tierGroupType] ?? {};
    for (const [tier, skus] of Object.entries(groups)) {
      for (const sku of skus) map[sku] = tier;
    }
    return map;
  }, [context, tierGroupType]);

  const focusSkus = skusByBrand[focusBrand] ?? [];
  const studyIncludedFocusSkus = useMemo(
    () => focusSkus.filter(isStudyIncluded),
    [focusSkus],
  );
  const decisionSkus = useMemo(
    () => (focusBrand ? toProducts(focusBrand, studyIncludedFocusSkus) : []),
    [focusBrand, studyIncludedFocusSkus],
  );
  const summaryLoading =
    Boolean(focusBrand) && summariesQueryLoading && focusSkus.length === 0;

  // Seed reference + include flags from study lineup when focus brand SKUs load.
  useEffect(() => {
    if (!focusBrand || studyIncludedFocusSkus.length === 0) return;
    const suggested = highestShareSku(studyIncludedFocusSkus);
    setReferenceSkuByBrand((prev) => {
      const current = prev[focusBrand];
      if (current && studyIncludedFocusSkus.some((s) => s.name === current)) return prev;
      if (!suggested) return prev;
      return { ...prev, [focusBrand]: suggested };
    });
    setOptSelectedSkus((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of studyIncludedFocusSkus) {
        if (next[s.name] !== undefined) continue;
        next[s.name] = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [focusBrand, studyIncludedFocusSkus]);

  const includedFocusSkus = useMemo(
    () => studyIncludedFocusSkus.filter((s) => optSelectedSkus[s.name] === true),
    [studyIncludedFocusSkus, optSelectedSkus],
  );
  const missingUnitCostNames = useMemo(
    () =>
      includedFocusSkus
        .filter((s) => s.unit_cost == null || !Number.isFinite(s.unit_cost))
        .map((s) => s.name),
    [includedFocusSkus],
  );
  const suggestedRefSku = useMemo(
    () =>
      highestShareSku(
        includedFocusSkus.length > 0 ? includedFocusSkus : studyIncludedFocusSkus,
      ),
    [includedFocusSkus, studyIncludedFocusSkus],
  );
  const focusRefSku = useMemo(() => {
    const manual = focusBrand ? referenceSkuByBrand[focusBrand] : undefined;
    if (manual && optSelectedSkus[manual] === true) return manual;
    return suggestedRefSku ?? "";
  }, [focusBrand, referenceSkuByBrand, optSelectedSkus, suggestedRefSku]);
  const focusRefPrice =
    studyIncludedFocusSkus.find((s) => s.name === focusRefSku)?.base_price ??
    studyIncludedFocusSkus[0]?.base_price ??
    1;
  const focusRefCost = useMemo(() => {
    const sku = studyIncludedFocusSkus.find((s) => s.name === focusRefSku);
    if (!sku || sku.unit_cost == null || !Number.isFinite(sku.unit_cost)) return null;
    return sku.unit_cost;
  }, [studyIncludedFocusSkus, focusRefSku]);

  const setFocusBrand = (brand: string) => {
    setFocusBrandState(brand);
    setAnchorIdx(0);
    setExpandedAnchorBrands({});
    setCompMoves({});
    setAppliedCompMoves({});
    setReactionMoves({});
    setReactionError(null);
    setRunResult(null);
    setLastJobId(null);
    setOpenSimError(null);
    setRunError(null);
  };

  const focusSkuNames = useMemo(
    () => new Set((skusByBrand[focusBrand] ?? []).map((s) => s.name)),
    [skusByBrand, focusBrand],
  );

  const crossBrandParams = useMemo(() => {
    if (!focusRefSku || !groupType) return {};
    return {
      ...buildBaseQueryParams(setup),
      level: "group",
      group_type: groupType,
      driver_product: focusRefSku,
      scale: String(PRICE_SHOCK_MULT),
    };
  }, [focusRefSku, groupType, setup]);

  const crossBrandSkuParams = useMemo(() => {
    if (!focusRefSku) return {};
    return {
      ...buildBaseQueryParams(setup),
      level: "sku",
      driver_product: focusRefSku,
      scale: String(PRICE_SHOCK_MULT),
    };
  }, [focusRefSku, setup]);

  const {
    data: crossBrandResp,
    isLoading: crossBrandLoading,
    isError: crossBrandError,
    error: crossBrandErr,
  } = useAnalytics(slug, "cross-brand", crossBrandParams, {
    enabled: pageActive && Boolean(slug && focusRefSku && groupType),
  });

  const {
    data: crossBrandSkuResp,
    isLoading: crossBrandSkuLoading,
    isError: crossBrandSkuError,
    error: crossBrandSkuErr,
  } = useAnalytics(slug, "cross-brand", crossBrandSkuParams, {
    enabled: pageActive && Boolean(slug && focusRefSku),
  });

  const crossBrandData = (crossBrandResp?.data ?? null) as CrossBrandData | null;
  const crossBrandSkuData = (crossBrandSkuResp?.data ?? null) as CrossBrandData | null;
  const switchingShareLoading = crossBrandLoading || crossBrandSkuLoading;
  const switchingShareError = crossBrandError || crossBrandSkuError;
  const switchingShareErr = crossBrandErr ?? crossBrandSkuErr;

  const switchingByBrand = useMemo(
    () => switchingSharesFromCrossBrand(crossBrandData, focusBrand),
    [crossBrandData, focusBrand],
  );

  const switchingBySku = useMemo(
    () => switchingSharesFromCrossBrandSku(crossBrandSkuData, focusSkuNames),
    [crossBrandSkuData, focusSkuNames],
  );

  const anchorCandidates = useMemo(() => {
    const ownBrandSet = new Set(brands);
    const rows: AnchorBrandCandidate[] = [];
    for (const brand of allGroupBrands) {
      if (brand === focusBrand) continue;
      const brandSkus = (skusByBrand[brand] ?? []).filter(isStudyIncluded);
      const pricedSkus = brandSkus.filter((s) => s.base_price > 0);
      if (pricedSkus.length === 0) continue;

      const skuOptions: AnchorSkuOption[] = pricedSkus
        .map((s) => ({
          name: s.name,
          share: switchingBySku[s.name] ?? 0,
          price: s.base_price,
        }))
        .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));

      const defaultSku = highestShareSku(pricedSkus) ?? skuOptions[0]?.name ?? "";
      const anchorSku =
        anchorSkuByBrand[brand] && pricedSkus.some((s) => s.name === anchorSkuByBrand[brand])
          ? anchorSkuByBrand[brand]
          : defaultSku;
      const anchorSkuRow = skuOptions.find((s) => s.name === anchorSku) ?? skuOptions[0];
      if (!anchorSkuRow) continue;

      rows.push({
        brand,
        share: switchingByBrand[brand] ?? 0,
        anchorSku: anchorSkuRow.name,
        anchorPrice: anchorSkuRow.price,
        skus: skuOptions,
        isOwn: ownBrandSet.has(brand),
      });
    }
    rows.sort((a, b) => b.share - a.share || a.brand.localeCompare(b.brand));
    return rows;
  }, [allGroupBrands, brands, focusBrand, skusByBrand, switchingByBrand, switchingBySku, anchorSkuByBrand]);

  const cannibalizationRows = useMemo(
    () => anchorCandidates.filter((c) => c.isOwn),
    [anchorCandidates],
  );
  const competitionRows = useMemo(
    () => anchorCandidates.filter((c) => !c.isOwn),
    [anchorCandidates],
  );
  const competitionDisplay = useMemo(
    () => collapseSwitchingRows(competitionRows),
    [competitionRows],
  );
  const cannibalizationDisplay = useMemo(
    () => collapseSwitchingRows(cannibalizationRows),
    [cannibalizationRows],
  );
  const selectableCompetition = competitionDisplay.top;
  const cannibRaw = useMemo(
    () => cannibalizationRows.reduce((s, c) => s + c.share, 0),
    [cannibalizationRows],
  );
  const compRaw = useMemo(
    () => competitionRows.reduce((s, c) => s + c.share, 0),
    [competitionRows],
  );
  const totalRaw = cannibRaw + compRaw;
  const cannibTotal = totalRaw > 0 ? Math.round((cannibRaw / totalRaw) * 100) : 0;
  const compTotal = totalRaw > 0 ? 100 - cannibTotal : 0;

  useEffect(() => {
    if (anchorCandidates.length === 0) return;
    setAnchorSkuByBrand((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of anchorCandidates) {
        if (next[row.brand] && row.skus.some((s) => s.name === next[row.brand])) continue;
        next[row.brand] = row.anchorSku;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [anchorCandidates]);

  // Corridor anchor is always a competitor — never own-brand cannibalization.
  useEffect(() => {
    if (selectableCompetition.length === 0) {
      if (anchorIdx !== 0) setAnchorIdx(0);
      return;
    }
    const selected = anchorCandidates[anchorIdx];
    const stillSelectable =
      selected &&
      !selected.isOwn &&
      selectableCompetition.some((c) => c.brand === selected.brand);
    if (stillSelectable) return;
    const nextIdx = anchorCandidates.findIndex(
      (c) => c.brand === selectableCompetition[0].brand,
    );
    if (nextIdx >= 0 && nextIdx !== anchorIdx) setAnchorIdx(nextIdx);
  }, [anchorCandidates, selectableCompetition, anchorIdx]);

  const safeAnchorIdx = Math.min(anchorIdx, Math.max(0, anchorCandidates.length - 1));
  const selectedAnchorBrand =
    anchorCandidates[safeAnchorIdx] && !anchorCandidates[safeAnchorIdx].isOwn
      ? anchorCandidates[safeAnchorIdx]
      : selectableCompetition[0] ?? null;
  const selectedAnchor = useMemo(() => {
    if (!selectedAnchorBrand) return null;
    return {
      brand: selectedAnchorBrand.brand,
      sku: selectedAnchorBrand.anchorSku,
      share: selectedAnchorBrand.share,
      price: selectedAnchorBrand.anchorPrice,
    };
  }, [selectedAnchorBrand]);
  const effectiveCompMoves = COMPETITIVE_MOVES_ENABLED ? appliedCompMoves : EMPTY_COMP_MOVES;
  const appliedMoveList = useMemo(
    () => toCompetitorMoves(effectiveCompMoves),
    [effectiveCompMoves],
  );
  const pendingCompApply =
    COMPETITIVE_MOVES_ENABLED && !movesEqual(compMoves, appliedCompMoves);
  const selectedAnchorMovedPrice = selectedAnchor
    ? selectedAnchor.price * (1 + (effectiveCompMoves[selectedAnchor.brand] ?? 0) / 100)
    : null;
  /** Anchor pack price for index labels only — does not change the corridor simulation. */
  const displayAnchorPrice = selectedAnchorMovedPrice ?? selectedAnchor?.price ?? null;

  // Sweep depends on focus SKU + competitor moves only. Guardrail sliders
  // re-cut min/max/recommended client-side via deriveCorridorBounds — no refetch.
  const corridorFetchBody = useMemo(() => {
    if (!groupType || !focusBrand || !focusRefSku || focusRefPrice <= 0) return null;
    return {
      group_type: groupType,
      brand: focusBrand,
      reference_sku: focusRefSku,
      anchor_price: focusRefPrice,
      n_points: 28,
      ...setup,
      ...(appliedMoveList.length > 0 ? { competitor_moves: appliedMoveList } : {}),
    };
  }, [
    groupType,
    focusBrand,
    focusRefSku,
    focusRefPrice,
    appliedMoveList,
    setup,
  ]);

  const {
    data: corridorPreview,
    isLoading: corridorLoading,
    isFetching: corridorFetching,
    isError: corridorError,
    error: corridorErr,
  } = useCorridorPreview(slug, corridorFetchBody, { enabled: pageActive });

  const corridorPoints = corridorPreview?.points ?? [];
  const corridorPriceBounds = useMemo(() => {
    const lo = corridorPreview?.calibrated_price_lo;
    const hi = corridorPreview?.calibrated_price_hi;
    if (lo != null && hi != null && lo > 0 && hi >= lo) return { lo, hi };
    const prices = corridorPoints.map((p) => p.price).filter((p) => p > 0);
    if (prices.length === 0) return null;
    return { lo: Math.min(...prices), hi: Math.max(...prices) };
  }, [corridorPreview, corridorPoints]);
  const corridorBounds = useMemo(() => {
    if (corridorPoints.length === 0 || !corridorPriceBounds) return null;
    return deriveCorridorBounds(corridorPoints, {
      marginFloorPct: marginFloor,
      volumeCapPct: shareLossLimit,
      refCost: focusRefCost,
      priceLo: corridorPriceBounds.lo,
      priceHi: corridorPriceBounds.hi,
      indexAnchorPrice: focusRefPrice,
    });
  }, [
    corridorPoints,
    corridorPriceBounds,
    marginFloor,
    shareLossLimit,
    focusRefCost,
    focusRefPrice,
  ]);
  const corridorWarnings = corridorPreview?.warnings ?? [];
  const corridorRefreshing = corridorFetching && corridorPoints.length > 0;

  // Focus brand scopes the run; only explicitly checked SKUs are included.
  const selectedForRun = useMemo(() => {
    const selected: Record<string, boolean> = {};
    decisionSkus.forEach((p) => {
      selected[p.name] = optSelectedSkus[p.name] === true;
    });
    return selected;
  }, [decisionSkus, optSelectedSkus]);
  const includedSkuCount = useMemo(
    () => Object.values(selectedForRun).filter(Boolean).length,
    [selectedForRun],
  );

  const runOptimizer = async () => {
    if (!slug || !groupType || !focusBrand || skuBounds.length === 0) return;

    const nextApplied = !COMPETITIVE_MOVES_ENABLED
      ? {}
      : pendingCompApply
        ? { ...compMoves }
        : appliedCompMoves;
    if (COMPETITIVE_MOVES_ENABLED && pendingCompApply) setAppliedCompMoves(nextApplied);
    const anchorMove = selectedAnchor ? (nextApplied[selectedAnchor.brand] ?? 0) : 0;
    const startAnchorPrice = selectedAnchor
      ? selectedAnchor.price * (1 + anchorMove / 100)
      : null;

    const boundsBySku = new Map(skuBounds.map((b) => [b.sku, b]));
    const bounds = decisionSkus
      .map((p) => boundsBySku.get(p.name))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => ({
        sku: b.sku,
        base_price: b.base_price,
        lo: b.lo,
        hi: b.hi,
        cost: b.cost ?? 0,
        included: selectedForRun[b.sku] === true,
      }));

    if (bounds.filter((b) => b.included).length === 0) return;
    if (objective === "Margin" && missingUnitCostNames.length > 0) {
      setRunError(
        `Unit costs are missing for ${missingUnitCostNames.slice(0, 8).join(", ")}. Add a Unit Costs sheet to the design workbook, or upload a CSV on Data Hub.`,
      );
      return;
    }

    const previewCorridor = corridorRatiosFromPreview(corridorBounds, startAnchorPrice);

    setRunning(true);
    setRunError(null);
    setRunProgress(null);
    setRunResult(null);
    setLastJobId(null);

    const runRequest: RunOptimizerRequest = {
      group_type: groupType,
      brand: focusBrand,
      bounds,
      objective: objectiveToBackend(objective),
      scope: "brand",
      max_volume_drop_pct: shareLossLimit,
      min_margin_pct: missingUnitCostNames.length === 0 ? marginFloor : undefined,
      reference_sku: focusRefSku || null,
      anchor_label: selectedAnchor
        ? `${selectedAnchor.brand} · ${selectedAnchor.sku}`
        : null,
      anchor_price: startAnchorPrice,
      corridor_min: previewCorridor.corridor_min,
      corridor_max: previewCorridor.corridor_max,
      competitor_moves: toCompetitorMoves(nextApplied),
      ...setup,
    };
    const runUiContext = {
      objective,
      margin_floor_pct: marginFloor,
      max_volume_drop_pct: shareLossLimit,
      reference_sku: focusRefSku,
      focus_brand: focusBrand,
      group_type: groupType,
      selected_skus: selectedForRun,
      anchor: selectedAnchor,
      corridor_preview: {
        min_price: corridorBounds?.min?.price ?? null,
        max_price: corridorBounds?.max?.price ?? null,
        min_ratio: previewCorridor.corridor_min,
        max_ratio: previewCorridor.corridor_max,
        anchor_price: startAnchorPrice,
      },
      applied_competitor_moves: nextApplied,
    };
    setLastRunDebug({ request: runRequest, ui: runUiContext });

    try {
      const { jobId, result } = await runOptimizerJob(
        slug,
        runRequest,
        (evals, estimated) => setRunProgress({ evals, estimated }),
      );
      setRunResult(result);
      setLastJobId(jobId);

      if (result.solution_status === "infeasible") {
        setLastJobId(null);
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Optimization failed");
    } finally {
      setRunning(false);
      setRunProgress(null);
    }
  };

  const openOptimizedInSimulator = async () => {
    if (!slug || !session || !lastJobId || !focusBrand) return;
    setOpeningSimulator(true);
    setOpenSimError(null);
    const scenarioName = `${focusBrand} ${objectiveScenarioLabel(objective)} optimized`;
    try {
      const saved = await saveOptimizerScenario(
        slug,
        lastJobId,
        `Optimizer: ${focusBrand}, objective=${objective}`,
        scenarioName,
      );
      await queryClient.invalidateQueries({ queryKey: ["scenarios", slug] });
      const payload = await applyScenario.mutateAsync({
        sessionId: session.sessionId,
        name: saved.scenario_name,
      });
      setSession(payload);
      navigate("/runner");
    } catch (err) {
      setOpenSimError(err instanceof Error ? err.message : "Failed to open scenario in Simulator");
    } finally {
      setOpeningSimulator(false);
    }
  };

  const reactionMoveList = useMemo(
    () => toCompetitorMoves(reactionMoves),
    [reactionMoves],
  );

  const derived = useMemo(() => {
    const perUnit = decisionSkus.some((p) => p.size != null);
    const sym = display.currencySymbol;
    if (!runResult) {
      return { rows: [] as OptTableRow[], perUnit };
    }

    const skuRowByName = new Map(runResult.sku_rows.map((row) => [row.name, row]));

    // Results table: decision SKUs only (focus brand, selected for the run).
    const optRows: OptTableRow[] = decisionSkus
      .filter((p) => selectedForRun[p.name] === true)
      .map((p) => {
        const row = skuRowByName.get(p.name);
        const unit = p.size ?? null;
        if (!row) {
          const recPerUnit = unit && p.basePrice > 0 ? p.basePrice / unit : null;
          return {
            name: p.name,
            brand: p.brand,
            tier: tierBySku[p.name] ?? UNGROUPED_TIER,
            optimized: true,
            currentText: unit ? fmt(p.basePrice / unit, 2) : "—",
            recText: unit ? fmt(p.basePrice / unit, 2) : "—",
            size: unit,
            recPerUnit,
            discountText: "—",
            packNote: unit ? `Pack: ${sym}${fmt(p.basePrice, 2)}` : "",
            unitPriceText: fmt(p.basePrice, 2),
            recUnitPriceText: fmt(p.basePrice, 2),
            baseVolShareText: "—",
            newVolShareText: "—",
            volShareGainText: "—",
            revIndexText: "—",
            volShareGain: 0,
            baseVolShare: 0,
            newVolShare: 0,
            baseRev: 0,
            newRev: 0,
            limitedBy: "not in result",
            conflict: false,
          };
        }

        const rec = row.optimal_price;
        const conflict = row.lo > row.hi + 1e-9;
        const recPerUnit = unit && rec > 0 ? rec / unit : null;

        return {
          name: p.name,
          brand: p.brand,
          tier: tierBySku[p.name] ?? UNGROUPED_TIER,
          optimized: row.optimized,
          currentText: unit ? fmt(row.base_price / unit, 2) : "—",
          recText: unit ? fmt(rec / unit, 2) : "—",
          size: unit,
          recPerUnit,
          discountText: "—",
          packNote: unit
            ? `Pack: ${sym}${fmt(row.base_price, 2)} → ${sym}${fmt(rec, 2)}`
            : "",
          unitPriceText: fmt(row.base_price, 2),
          recUnitPriceText: fmt(rec, 2),
          baseVolShareText: formatVolShare(row.base_vol_share),
          newVolShareText: formatVolShare(row.new_vol_share),
          volShareGainText: formatVolShareGain(row.share_delta_pp),
          revIndexText: formatRevIndex(row.base_rev, row.new_rev),
          volShareGain: row.share_delta_pp,
          baseVolShare: row.base_vol_share,
          newVolShare: row.new_vol_share,
          baseRev: row.base_rev,
          newRev: row.new_rev,
          limitedBy: formatLimitedBy(row.limited_by ?? undefined),
          conflict,
        };
      });

    return { rows: applyTierDiscountIndex(flattenGroups(groupRows(optRows))), perUnit };
  }, [runResult, decisionSkus, selectedForRun, tierBySku, display.currencySymbol]);

  /** Per-column sigma from SKU rows in this run — drives gain/index coloring. */
  const resultsColorSigmas = useMemo(() => {
    const volShareGains = derived.rows.map((r) => r.volShareGain);
    const revIndexDeltas = derived.rows
      .map((r) => revIndexValue(r.baseRev, r.newRev))
      .filter((v): v is number => v != null)
      .map((idx) => idx - 1);
    return {
      volShareGain: computeColumnSigma(volShareGains),
      revIndex: computeColumnSigma(revIndexDeltas),
    };
  }, [derived.rows]);

  const focusBrandSkuNames = useMemo(
    () => new Set((skusByBrand[focusBrand] ?? []).map((s) => s.name)),
    [skusByBrand, focusBrand],
  );

  const manufacturerSkuNames = useMemo(() => {
    if (ownSet.size > 0) return ownSet;
    const names = new Set<string>();
    for (const brand of brands) {
      for (const s of skusByBrand[brand] ?? []) names.add(s.name);
    }
    return names;
  }, [ownSet, brands, skusByBrand]);

  const manufacturerLabel = session?.study.companyName?.trim() || "Manufacturer";

  const manufacturerMetrics = useMemo(() => {
    const rows = runResult?.market_rows;
    if (!rows?.length || manufacturerSkuNames.size === 0) return null;
    const agg = aggregateMarketScope(rows, manufacturerSkuNames);
    return {
      baseVol: agg.baseVol,
      newVol: agg.newVol,
      baseRev: agg.baseRev,
      newRev: agg.newRev,
    };
  }, [runResult, manufacturerSkuNames]);

  const scenarioCompareData = useMemo(() => {
    if (!runResult) return null;
    if (compareScope === "brand" && runResult.brand_totals) {
      const t = runResult.brand_totals;
      return toScenarioComparePoints(
        t.base_vol,
        t.new_vol,
        t.base_val,
        t.new_val,
        t.base_rev,
        t.new_rev,
        "Optimized",
      );
    }
    const rows = runResult.market_rows;
    if (!rows?.length) return null;
    const skuNames =
      compareScope === "brand" ? focusBrandSkuNames : manufacturerSkuNames;
    if (skuNames.size === 0) return null;
    const agg = aggregateMarketScope(rows, skuNames);
    return toScenarioComparePoints(
      agg.baseVol,
      agg.newVol,
      agg.baseVal,
      agg.newVal,
      agg.baseRev,
      agg.newRev,
      "Optimized",
    );
  }, [
    runResult,
    compareScope,
    focusBrandSkuNames,
    manufacturerSkuNames,
  ]);

  const totalRows = derived.rows.length;
  const tableColCount = (derived.perUnit ? 3 : 0) + 7;
  const pageGroups = useMemo(() => groupRows(derived.rows), [derived.rows]);

  if (!slug) {
    return <Navigate to="/data-hub" replace />;
  }

  if (contextLoading) {
    return (
      <div className="optimizer-page">
        <div className="opt-card">
          <p className="opt-section-sub">Loading optimizer catalog…</p>
        </div>
      </div>
    );
  }

  if (contextError) {
    return (
      <div className="optimizer-page">
        <div className="opt-card">
          <h2 className="opt-section-title">Could not load optimizer context</h2>
          <p className="opt-section-sub">
            {contextErr instanceof Error ? contextErr.message : "Request failed"}
          </p>
        </div>
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <div className="optimizer-page">
        <div className="opt-card">
          <h2 className="opt-section-title">No brands available</h2>
          <p className="opt-section-sub">
            This study has no brands available to optimize.
          </p>
        </div>
      </div>
    );
  }

  const showRunErrorPanel = Boolean(
    runError || runResult?.solution_status === "infeasible",
  );

  return (
    <div className="optimizer-page">
      <div className="opt-stack">
        {/* Decision SKUs */}
        <div className="opt-card">
          <div className="opt-card-head">
            <h2 className="opt-section-title">Set up your price optimization</h2>
          </div>

          <div className="opt-section-intro">
            <div className="opt-section-intro-copy">
              Set an objective and guardrails, and the model returns a <b>recommended price</b> per SKU —
              anchored to the competitor the conjoint says consumers actually switch to, and held
              consistent across pack formats.
            </div>
            {recommendationConfidence ? (
              <div
                className={`opt-pill ${
                  recommendationConfidence === "High" ? "opt-pill-amber" : "opt-pill-low-confidence"
                }`}
              >
                {recommendationConfidenceLabel(recommendationConfidence)}
              </div>
            ) : null}
          </div>

          <div className="opt-setup-split">
            <div className="opt-setup-objective opt-setup-panel">
              <h3 className="opt-panel-title">Objective &amp; guardrails</h3>
              <p className="opt-panel-sub">
                Automated recommendation for the selected focus SKUs
              </p>

              <label className="opt-field opt-focus-field">
                Focus brand
                <select
                  value={focusBrand}
                  onChange={(e) => setFocusBrand(e.target.value)}
                >
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>

              <label className="opt-field opt-objective-field">
                Objective
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as Objective)}
                >
                  <option value="Margin">Maximize contribution margin</option>
                  <option value="Share">Maximize volume</option>
                  <option value="ValueShare">Maximize value share</option>
                </select>
              </label>

              <div className="opt-guardrail-sliders">
                <div className="opt-slider-row">
                  <div className="opt-slider-lab">
                    <span>Max volume drop</span>
                    <span className="opt-slider-lab-note">(vs current)</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={shareLossLimit}
                    style={
                      {
                        "--opt-slider-fill": `${(shareLossLimit / 20) * 100}%`,
                      } as React.CSSProperties
                    }
                    onChange={(e) => setShareLossLimit(Number(e.target.value))}
                  />
                  <div className="opt-slider-val">{shareLossLimit}%</div>
                </div>
                <div className="opt-slider-row">
                  <div className="opt-slider-lab">
                    <span>Min contribution margin</span>
                    <span className="opt-slider-lab-note">(absolute)</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={50}
                    value={marginFloor}
                    style={
                      {
                        "--opt-slider-fill": `${((marginFloor - 20) / 30) * 100}%`,
                      } as React.CSSProperties
                    }
                    onChange={(e) => setMarginFloor(Number(e.target.value))}
                  />
                  <div className="opt-slider-val">{marginFloor}%</div>
                </div>
              </div>

              <div className="opt-note">
                These two guardrails set the feasible price corridor below — the model won&apos;t recommend a
                price that breaches either one, even if a further move would raise unit margin.
              </div>
              {missingUnitCostNames.length > 0 ? (
                <div className="opt-note opt-note-warn">
                  Unit costs are missing for {missingUnitCostNames.length} selected SKU
                  {missingUnitCostNames.length === 1 ? "" : "s"}. Add a Unit Costs sheet to the design
                  workbook, or upload a CSV on Data Hub. The margin floor stays off until every selected
                  SKU has a cost.
                </div>
              ) : null}
            </div>

            <div className="opt-setup-skus opt-setup-panel">
              <h3 className="opt-panel-title">Reference SKU</h3>
              <p className="opt-panel-sub">
                SKUs in the study lineup are checked automatically; excluded SKUs are omitted.
                Uncheck any you want to hold out of this run, and set the reference SKU. Its
                anchor is selected from switching share after a {PRICE_SHOCK_PCT}%
                reference-SKU price shock, below.
              </p>

              <div className="opt-sku-list">
                {summaryLoading ? (
                  <div className="opt-note">Loading SKUs…</div>
                ) : decisionSkus.length === 0 && summaryError ? (
                  <div className="opt-note">
                    Could not load brand summary
                    {summaryErr instanceof Error ? `: ${summaryErr.message}` : "."}
                  </div>
                ) : decisionSkus.length === 0 ? (
                  <div className="opt-note">No included SKUs in this brand.</div>
                ) : (
                  decisionSkus.map((p) => {
                    const checked = optSelectedSkus[p.name] === true;
                    const isRef = focusRefSku === p.name;
                    return (
                      <div key={p.name} className="opt-sku-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setOptSelectedSkus((prev) => ({ ...prev, [p.name]: e.target.checked }))
                          }
                        />
                        <span className="opt-sku-name">{p.name}</span>
                        <button
                          type="button"
                          className={`opt-ref-btn${isRef ? " active" : ""}`}
                          onClick={() => {
                            setReferenceSkuByBrand((prev) => ({
                              ...prev,
                              [focusBrand]: p.name,
                            }));
                            setOptSelectedSkus((prev) => ({ ...prev, [p.name]: true }));
                          }}
                        >
                          {isRef ? "★ Reference" : "Set reference"}
                        </button>
                        <span className="opt-sku-price">{fmt(p.basePrice, 2)}</span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="opt-note">
                Suggested reference SKU (highest volume share):{" "}
                <b>{suggestedRefSku ?? "—"}</b>
                {focusRefSku && suggestedRefSku && focusRefSku !== suggestedRefSku ? (
                  <>
                    {" "}
                    · Active: <b>{focusRefSku}</b>
                  </>
                ) : null}
                .
              </div>
            </div>
          </div>

          <div className="opt-setup-panel opt-anchor-panel">
            <h3 className="opt-panel-title">Corridor Analysis</h3>
            <p className="opt-panel-sub">
              Where consumers switch to if <b>{focusBrand}</b> raises price {PRICE_SHOCK_PCT}% —
              from shocking the focus reference SKU in the simulator. Expand a competitor to pick
              the anchor SKU; select the brand an RGM manager would defend to the category buyer.
              Cannibalization is own-brand switching and is not used as a corridor anchor.
            </p>
            {switchingShareLoading ? (
              <div className="opt-note">Computing switching shares…</div>
            ) : switchingShareError ? (
              <div className="opt-note">
                Could not load switching shares
                {switchingShareErr instanceof Error ? `: ${switchingShareErr.message}` : "."}
              </div>
            ) : anchorCandidates.length === 0 ? (
              <div className="opt-note">No brands available for this focus brand.</div>
            ) : (
            <div className="opt-anchor-tables">
              <div className="opt-anchor-table-block">
                <h4 className="opt-anchor-table-title">Cannibalization ({cannibTotal}%)</h4>
                <div className="opt-anchor-scroll">
                  <table className="opt-anchor-table opt-anchor-table--readonly">
                    <thead>
                      <tr>
                        <th>Own brand / SKU</th>
                        <th className="num">Switching share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cannibalizationDisplay.top.map((c) => {
                        const expanded = Boolean(expandedAnchorBrands[c.brand]);
                        return (
                          <Fragment key={c.brand}>
                            <tr className={expanded ? "opt-row-expanded" : undefined}>
                              <td>
                                <div className="opt-anchor-brand-cell">
                                  <button
                                    type="button"
                                    className="opt-anchor-expand"
                                    aria-expanded={expanded}
                                    aria-label={`${expanded ? "Collapse" : "Expand"} ${c.brand} SKUs`}
                                    onClick={() =>
                                      setExpandedAnchorBrands((prev) => ({
                                        ...prev,
                                        [c.brand]: !prev[c.brand],
                                      }))
                                    }
                                  >
                                    {expanded ? "▾" : "▸"}
                                  </button>
                                  <span className="opt-anchor-brand">
                                    {c.brand}
                                  </span>
                                </div>
                              </td>
                              <td className="num">{fmt(c.share, 0)}%</td>
                            </tr>
                            {expanded &&
                              c.skus.map((sku) => (
                                <tr key={`${c.brand}::${sku.name}`} className="opt-anchor-sku-row">
                                  <td>
                                    <span className="opt-anchor-sku-name">
                                      <span className="opt-anchor-sku-nest" aria-hidden="true" />
                                      {sku.name}
                                    </span>
                                  </td>
                                  <td className="num">{fmt(sku.share, 0)}%</td>
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                      {cannibalizationDisplay.top.length === 0 && (
                        <tr>
                          <td colSpan={2} className="opt-anchor-empty">
                            No own-brand switching in this shock.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {cannibalizationDisplay.other && (
                    <table className="opt-anchor-table opt-anchor-table--readonly opt-anchor-other-table">
                      <tbody>
                        <tr className="opt-anchor-other-row">
                          <td>
                            <span className="opt-anchor-brand">
                              Other
                              <span className="opt-anchor-brand-sku">
                                · {cannibalizationDisplay.other.brands.length} brands
                              </span>
                            </span>
                          </td>
                          <td className="num">{fmt(cannibalizationDisplay.other.share, 0)}%</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="opt-anchor-table-block">
                <h4 className="opt-anchor-table-title">Competition ({compTotal}%)</h4>
                <div className="opt-anchor-scroll">
                  <table className="opt-anchor-table">
                    <thead>
                      <tr>
                        <th>Competitor brand / SKU</th>
                        <th className="num">Switching share</th>
                        <th className="num">Price index vs. focus</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {competitionDisplay.top.map((c) => {
                        const globalIdx = anchorCandidates.indexOf(c);
                        const expanded = Boolean(expandedAnchorBrands[c.brand]);
                        const brandIdxNow = brandPriceIndex(
                          c,
                          focusRefPrice,
                          effectiveCompMoves[c.brand] ?? 0,
                        );
                        const active = selectedAnchorBrand?.brand === c.brand;
                        return (
                          <Fragment key={c.brand}>
                            <tr className={expanded ? "opt-row-expanded" : undefined}>
                              <td>
                                <div className="opt-anchor-brand-cell">
                                  <button
                                    type="button"
                                    className="opt-anchor-expand"
                                    aria-expanded={expanded}
                                    aria-label={`${expanded ? "Collapse" : "Expand"} ${c.brand} SKUs`}
                                    onClick={() =>
                                      setExpandedAnchorBrands((prev) => ({
                                        ...prev,
                                        [c.brand]: !prev[c.brand],
                                      }))
                                    }
                                  >
                                    {expanded ? "▾" : "▸"}
                                  </button>
                                  <span className="opt-anchor-brand">
                                    {c.brand}
                                  </span>
                                </div>
                              </td>
                              <td className="num">{fmt(c.share, 0)}%</td>
                              <td className="num">{brandIdxNow}</td>
                              <td className="opt-anchor-action">
                                <button
                                  type="button"
                                  className={`opt-anchor-btn${active ? " active" : ""}`}
                                  onClick={() => setAnchorIdx(globalIdx)}
                                >
                                  {active ? "Selected" : "Select"}
                                </button>
                              </td>
                            </tr>
                            {expanded &&
                              c.skus.map((sku) => {
                                const movedSkuPrice =
                                  sku.price * (1 + (effectiveCompMoves[c.brand] ?? 0) / 100);
                                const skuIdxNow =
                                  movedSkuPrice > 0
                                    ? Math.round((focusRefPrice / movedSkuPrice) * 100)
                                    : 0;
                                const isAnchorSku = c.anchorSku === sku.name;
                                return (
                                  <tr
                                    key={`${c.brand}::${sku.name}`}
                                    className="opt-anchor-sku-row"
                                  >
                                    <td>
                                      <span className="opt-anchor-sku-name">
                                        <span className="opt-anchor-sku-nest" aria-hidden="true" />
                                        {sku.name}
                                      </span>
                                    </td>
                                    <td className="num">{fmt(sku.share, 0)}%</td>
                                    <td className="num">{skuIdxNow}</td>
                                    <td className="opt-anchor-action">
                                      <button
                                        type="button"
                                        className={`opt-anchor-btn opt-anchor-sku-btn${isAnchorSku && active ? " active" : ""}`}
                                        onClick={() => {
                                          setAnchorSkuByBrand((prev) => ({
                                            ...prev,
                                            [c.brand]: sku.name,
                                          }));
                                          setAnchorIdx(globalIdx);
                                        }}
                                      >
                                        {isAnchorSku && active ? "★ Anchor SKU" : "Set anchor SKU"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                          </Fragment>
                        );
                      })}
                      {competitionDisplay.top.length === 0 && (
                        <tr>
                          <td colSpan={4} className="opt-anchor-empty">
                            No competitor switching in this shock.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {competitionDisplay.other && (
                    <table className="opt-anchor-table opt-anchor-other-table">
                      <tbody>
                        <tr className="opt-anchor-other-row">
                          <td>
                            <span className="opt-anchor-brand">
                              Other
                              <span className="opt-anchor-brand-sku">
                                · {competitionDisplay.other.brands.length} brands
                              </span>
                            </span>
                          </td>
                          <td className="num">{fmt(competitionDisplay.other.share, 0)}%</td>
                          <td className="num">
                            {otherPriceIndex(
                              competitionDisplay.other.brands,
                              focusRefPrice,
                              effectiveCompMoves,
                            ) ?? "—"}
                          </td>
                          <td className="opt-anchor-action" />
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
            )}

            {selectedAnchor && (
              <div className="opt-note">
                Active anchor: <b>{selectedAnchor.brand}</b> · <b>{selectedAnchor.sku}</b>
              </div>
            )}

            {selectedAnchor && (
              <div className="opt-corridor-grid">
                <div className="opt-corridor-card">
                  <h3 className="opt-panel-title">
                    Revenue Response Curve by Price Point | {focusRefSku || "Reference SKU"}
                  </h3>
                  <p className="opt-panel-sub">
                    {appliedMoveList.length > 0 ? (
                      <>
                        Starting from applied competitor moves. Volume, revenue, and sales
                        margin indexes meet at 100 at today&apos;s shelf price in that market.
                      </>
                    ) : (
                      <>
                        Assuming no other products are changing prices. Volume, revenue, and sales
                        margin indexes meet at 100 at today&apos;s shelf price.
                      </>
                    )}
                  </p>
                  {corridorWarnings.length > 0 && (
                    <div className="opt-note opt-note-warn">
                      {corridorWarnings.map((w) => (
                        <div key={w}>{w}</div>
                      ))}
                    </div>
                  )}
                  {corridorLoading && corridorPoints.length === 0 ? (
                    <div className="opt-note">Computing corridor preview…</div>
                  ) : corridorError && corridorPoints.length === 0 ? (
                    <div className="opt-note">
                      Could not load corridor preview
                      {corridorErr instanceof Error ? `: ${corridorErr.message}` : "."}
                    </div>
                  ) : corridorPoints.length === 0 ? (
                    <div className="opt-note">No corridor points returned.</div>
                  ) : !pageActive ? (
                    <div className="opt-note">Chart paused while another section is open.</div>
                  ) : (
                    <div
                      className={`opt-corridor-live${corridorRefreshing ? " is-refreshing" : ""}`}
                    >
                      <OptRefSkuResponseChart
                        points={corridorPoints}
                        baseline={corridorPreview?.baseline}
                        anchorPrice={displayAnchorPrice}
                        anchorLabel={selectedAnchor?.brand}
                        anchorSku={selectedAnchor?.sku}
                        currencySymbol={display.currencySymbol}
                        marginFloorPrice={corridorBounds?.margin_floor_price}
                        volumeCapPrice={
                          corridorBounds?.max_binding_label === "max volume drop"
                            ? corridorBounds.max?.price
                            : interpolatePriceAt(
                                corridorPoints.map((p) => ({
                                  price: p.price,
                                  value: p.brand_volume_drop_pct,
                                })),
                                shareLossLimit,
                                {
                                  minPrice: corridorBounds?.margin_floor_price ?? null,
                                },
                              )
                        }
                        marginFloorPct={marginFloor}
                        volumeCapPct={shareLossLimit}
                      />
                      {corridorRefreshing && (
                        <div className="opt-corridor-live-badge">Updating…</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="opt-corridor-card">
                  <h3 className="opt-panel-title">Corridor bounds</h3>
                  <p className="opt-panel-sub">
                    Min is the margin-floor price, max is where the brand volume cap bites (or the
                    calibrated price edge). Recommended is the highest ref-SKU contribution found by
                    scanning inside that band.
                  </p>
                  {!corridorBounds?.recommended ? (
                    <div className="opt-note">
                      {corridorLoading ? "Computing bounds…" : "No feasible corridor bounds yet."}
                    </div>
                  ) : (
                    <div
                      className={`opt-corridor-live${corridorRefreshing ? " is-refreshing" : ""}`}
                    >
                      <table className="opt-bounds-table">
                        <thead>
                          <tr>
                            <th>Bound</th>
                            <th className="num">Price point</th>
                            <th className="num">Price index</th>
                            <th className="num">SKU contribution</th>
                            <th className="num">Brand vol drop</th>
                          </tr>
                        </thead>
                        <tbody>
                          {corridorBounds.min && (
                            <tr>
                              <td>
                                Min price point{" "}
                                <span className="opt-pill">
                                  {corridorBounds.min_binding_label ?? "min contribution margin"}
                                </span>
                              </td>
                              <td className="num">
                                {display.currencySymbol}
                                {corridorBounds.min.price.toFixed(2)}
                              </td>
                              <td className="num">
                                {formatAnchorIndex(corridorBounds.min.price, displayAnchorPrice)}
                              </td>
                              <td className="num">
                                {corridorBounds.min.ref_sku_contribution_index.toFixed(0)}
                              </td>
                              <td className="num">
                                {corridorBounds.min.brand_volume_drop_pct >= 0 ? "+" : ""}
                                {corridorBounds.min.brand_volume_drop_pct.toFixed(1)}%
                              </td>
                            </tr>
                          )}
                          <tr className="opt-row-rec">
                            <td>
                              <b>Recommended price point</b>{" "}
                              <span className="opt-pill opt-pill-amber">peak SKU contribution</span>
                            </td>
                            <td className="num">
                              <b>
                                {display.currencySymbol}
                                {corridorBounds.recommended.price.toFixed(2)}
                              </b>
                            </td>
                            <td className="num">
                              <b>
                                {formatAnchorIndex(
                                  corridorBounds.recommended.price,
                                  displayAnchorPrice,
                                )}
                              </b>
                            </td>
                            <td className="num">
                              <b>{corridorBounds.recommended.ref_sku_contribution_index.toFixed(0)}</b>
                            </td>
                            <td className="num">
                              {corridorBounds.recommended.brand_volume_drop_pct >= 0 ? "+" : ""}
                              {corridorBounds.recommended.brand_volume_drop_pct.toFixed(1)}%
                            </td>
                          </tr>
                          {corridorBounds.max && (
                            <tr>
                              <td>
                                Max price point{" "}
                                <span className="opt-pill">
                                  {corridorBounds.max_binding_label ?? corridorBounds.binding_label}
                                </span>
                              </td>
                              <td className="num">
                                {display.currencySymbol}
                                {corridorBounds.max.price.toFixed(2)}
                              </td>
                              <td className="num">
                                {formatAnchorIndex(corridorBounds.max.price, displayAnchorPrice)}
                              </td>
                              <td className="num">
                                {corridorBounds.max.ref_sku_contribution_index.toFixed(0)}
                              </td>
                              <td className="num">
                                {corridorBounds.max.brand_volume_drop_pct >= 0 ? "+" : ""}
                                {corridorBounds.max.brand_volume_drop_pct.toFixed(1)}%
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {COMPETITIVE_MOVES_ENABLED && (
            <div className="opt-setup-panel opt-moves-panel">
              <h3 className="opt-panel-title">Optimize vs. competitive moves</h3>
              <p className="opt-panel-sub">
                Set an expected move for each competitor — apply to lock that market as the
                starting scenario for the recommendation
              </p>
              <div className="opt-moves-scroll">
                <table className="opt-moves-table">
                  <thead>
                    <tr>
                      <th>Competitor</th>
                      <th className="num">Switching share</th>
                      <th>Expected move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anchorCandidates.map((c) => (
                      <tr key={c.brand}>
                        <td>{c.brand}</td>
                        <td className="num">{fmt(c.share, 0)}%</td>
                        <td>
                          <select
                            className="opt-move-select"
                            value={compMoves[c.brand] ?? 0}
                            onChange={(e) =>
                              setCompMoves((prev) => ({
                                ...prev,
                                [c.brand]: Number(e.target.value),
                              }))
                            }
                          >
                            <option value={-10}>-10%</option>
                            <option value={-5}>-5%</option>
                            <option value={0}>No change</option>
                            <option value={5}>+5%</option>
                            <option value={10}>+10%</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="opt-moves-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!pendingCompApply}
                  onClick={() => {
                    setAppliedCompMoves({ ...compMoves });
                    setRunResult(null);
                    setLastJobId(null);
                    setRunError(null);
                  }}
                >
                  {pendingCompApply
                    ? appliedMoveList.length > 0
                      ? "Update starting scenario"
                      : "Apply as starting scenario"
                    : appliedMoveList.length > 0
                      ? "Starting scenario applied"
                      : "Apply as starting scenario"}
                </button>
              </div>
              <div className="opt-note">
                {appliedMoveList.length > 0 ? (
                  <>
                    Starting optimization from applied competitor prices:{" "}
                    <b>
                      {appliedMoveList
                        .map((m) => `${m.brand} ${m.pct > 0 ? "+" : ""}${m.pct}%`)
                        .join("; ")}
                    </b>
                    . The recommendation is the best {focusBrand} reaction in that market.
                  </>
                ) : (
                  <>
                    Set expected moves for the competitors above, then apply them — the optimizer
                    uses that market as the starting scenario and weighs competitors by switching
                    share to find the best combined {focusBrand} reaction that still holds the
                    stated objective.
                  </>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn-primary opt-run-btn"
            onClick={() => void runOptimizer()}
            disabled={
              running ||
              decisionSkus.length === 0 ||
              includedSkuCount === 0 ||
              skuBounds.length === 0
            }
          >
            {running ? (
              <>
                <span className="optimizer-spinner" />
                Running…
                {runProgress && runProgress.estimated > 0
                  ? ` ${runProgress.evals}/${runProgress.estimated}`
                  : ""}
              </>
            ) : (
              "Run recommendation"
            )}
          </button>
          {showRunErrorPanel && (
            <div className="opt-note opt-note-warn opt-error-panel" role="alert">
              <div className="opt-error-panel-msg">
                {runError ??
                  "No feasible prices under the current guardrails."}
                {runResult?.solution_status === "infeasible" &&
                  runResult.constraint_conflicts.length > 0 && (
                    <> {runResult.constraint_conflicts.join(" ")}</>
                  )}
              </div>
              {lastRunDebug && (
                <button
                  type="button"
                  className="btn-secondary opt-debug-download-btn"
                  onClick={() =>
                    downloadOptimizerDebugBundle({
                      slug: slug!,
                      request: lastRunDebug.request,
                      error: runError,
                      result: runResult,
                      ui: lastRunDebug.ui,
                    })
                  }
                >
                  Download debug inputs
                </button>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="optimizer-results">
          <div className="opt-card opt-table-card">
            <div className="opt-table-head">
              <div className="opt-table-head-copy">
                <h2 className="opt-section-title">Recommended price by SKU</h2>
                <p className="opt-section-sub">
                  Decision SKUs for <b>{focusBrand}</b>, grouped by tier.
                  Recommended {derived.perUnit ? display.perUnitLabel : "price"} is held consistent within each
                  tier — no tier arbitrage.
                </p>
              </div>
              {totalRows > 0 && runResult && slug ? (
                <button
                  type="button"
                  className="btn-secondary opt-export-btn"
                  onClick={() =>
                    downloadOptimizerResultsCsv({
                      slug,
                      focusBrand,
                      perUnit: derived.perUnit,
                      perUnitColumnLabel: display.perUnitLabel,
                      tableRows: derived.rows,
                      runResult,
                    })
                  }
                >
                  Export CSV
                </button>
              ) : null}
            </div>
            <div className="opt-table-scroll">
              <table className="opt-table opt-table-tree">
                <thead>
                  <tr>
                    <th>SKU</th>
                    {derived.perUnit && (
                      <th className="num">Current {display.perUnitLabel}</th>
                    )}
                    {derived.perUnit && (
                      <th className="num">Recommended {display.perUnitLabel}</th>
                    )}
                    {derived.perUnit && <th className="num">Discount</th>}
                    <th className="num">Current price</th>
                    <th className="num">Recommended price</th>
                    <th className="num">Base volume share</th>
                    <th className="num">New volume share</th>
                    <th className="num">Volume share gain</th>
                    <th className="num">New revenue index</th>
                  </tr>
                </thead>
                {totalRows === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={tableColCount} className="opt-table-empty">
                        Run the optimizer to see recommendations.
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  <>
                    {manufacturerMetrics && (
                      <tbody className="opt-table-section">
                        <tr className="opt-row-mfr">
                          <td>{manufacturerLabel}</td>
                          {derived.perUnit && <td className="num" />}
                          {derived.perUnit && <td className="num" />}
                          {derived.perUnit && <td className="num" />}
                          <td className="num" />
                          <td className="num" />
                          <td className="num">
                            {formatVolShare(manufacturerMetrics.baseVol)}
                          </td>
                          <td className="num">
                            {formatVolShare(manufacturerMetrics.newVol)}
                          </td>
                          <td className="num">
                            {formatVolShareGain(
                              manufacturerMetrics.newVol - manufacturerMetrics.baseVol,
                            )}
                          </td>
                          <td className="num">
                            {formatRevIndex(
                              manufacturerMetrics.baseRev,
                              manufacturerMetrics.newRev,
                            )}
                          </td>
                        </tr>
                      </tbody>
                    )}
                    {pageGroups.map((brandGroup) => {
                    const brandMetrics = aggregateGroupMetrics(
                      brandGroup.tiers.flatMap((t) => t.rows),
                    );
                    return (
                      <Fragment key={brandGroup.brand}>
                        <tbody className="opt-table-section">
                          <tr className="opt-row-brand">
                            <td>{brandGroup.brand}</td>
                            {derived.perUnit && <td className="num" />}
                            {derived.perUnit && <td className="num" />}
                            {derived.perUnit && <td className="num" />}
                            <td className="num" />
                            <td className="num" />
                            <td className="num">
                              {formatVolShare(brandMetrics.baseVolShare)}
                            </td>
                            <td className="num">
                              {formatVolShare(brandMetrics.newVolShare)}
                            </td>
                            <td className="num">
                              {formatVolShareGain(brandMetrics.volShareGain)}
                            </td>
                            <td className="num">
                              {formatRevIndex(brandMetrics.baseRev, brandMetrics.newRev)}
                            </td>
                          </tr>
                        </tbody>
                        {brandGroup.tiers.map((group) => {
                          const tierMetrics = aggregateGroupMetrics(group.rows);
                          return (
                            <Fragment key={group.tier || "__ungrouped"}>
                              {group.tier && (
                                <tbody className="opt-table-section">
                                  <tr className="opt-row-tier">
                                    <td>{group.tier}</td>
                                    {derived.perUnit && <td className="num" />}
                                    {derived.perUnit && <td className="num" />}
                                    {derived.perUnit && <td className="num" />}
                                    <td className="num" />
                                    <td className="num" />
                                    <td className="num">
                                      {formatVolShare(tierMetrics.baseVolShare)}
                                    </td>
                                    <td className="num">
                                      {formatVolShare(tierMetrics.newVolShare)}
                                    </td>
                                    <td className="num">
                                      {formatVolShareGain(tierMetrics.volShareGain)}
                                    </td>
                                    <td className="num">
                                      {formatRevIndex(tierMetrics.baseRev, tierMetrics.newRev)}
                                    </td>
                                  </tr>
                                </tbody>
                              )}
                              <tbody className="opt-sku-group">
                                {group.rows.map((row) => {
                                  const recNote = [row.packNote, `Limited by: ${row.limitedBy}`]
                                    .filter(Boolean)
                                    .join(" · ");
                                  return (
                                    <tr
                                      key={`${row.brand}::${row.name}`}
                                      className={`opt-row-sku${row.optimized ? "" : " opt-row-passive"}`}
                                    >
                                      <td className="product">{row.name}</td>
                                      {derived.perUnit && (
                                        <td className="num" title={row.packNote}>
                                          <OptPriceCell
                                            value={row.currentText}
                                            title={recNote}
                                            currencySymbol={display.currencySymbol}
                                          />
                                        </td>
                                      )}
                                      {derived.perUnit && (
                                        <td className="num" title={recNote}>
                                          <OptPriceCell
                                            value={row.recText}
                                            title={recNote}
                                            recommended={row.currentText !== row.recText}
                                            conflict={row.conflict}
                                            currencySymbol={display.currencySymbol}
                                          />
                                        </td>
                                      )}
                                      {derived.perUnit && (
                                        <td className="num">{row.discountText}</td>
                                      )}
                                      <td className="num">
                                        <OptPriceCell
                                          value={row.unitPriceText}
                                          title={recNote}
                                          currencySymbol={display.currencySymbol}
                                        />
                                      </td>
                                      <td className="num">
                                        <OptPriceCell
                                          value={row.recUnitPriceText}
                                          title={recNote}
                                          recommended={row.unitPriceText !== row.recUnitPriceText}
                                          conflict={row.conflict}
                                          currencySymbol={display.currencySymbol}
                                        />
                                      </td>
                                      <td className="num">{row.baseVolShareText}</td>
                                      <td className="num">{row.newVolShareText}</td>
                                      <td
                                        className={`num ${volShareGainDeltaClass(
                                          row.volShareGain,
                                          resultsColorSigmas.volShareGain,
                                        )}`}
                                      >
                                        {row.volShareGainText}
                                      </td>
                                      <td
                                        className={`num ${revIndexDeltaClass(
                                          revIndexValue(row.baseRev, row.newRev),
                                          resultsColorSigmas.revIndex,
                                        )}`}
                                      >
                                        {row.revIndexText}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  </>
                )}
              </table>
            </div>
            {runResult && (
              <div className="opt-table-compare">
                <div className="opt-table-head">
                  <div className="opt-table-head-copy">
                    <h2 className="opt-section-title">Base vs optimized</h2>
                    <p className="opt-section-sub">
                      Volume and value share (columns) with revenue index (line) across
                      scenarios.
                      {compareScope === "brand" ? (
                        <>
                          {" "}
                          Scope: focus brand <b>{focusBrand}</b>.
                        </>
                      ) : (
                        <> Scope: manufacturer — all own brands.</>
                      )}
                    </p>
                  </div>
                  <div className="opt-scope-toggle" role="group" aria-label="Comparison scope">
                    <button
                      type="button"
                      className={`opt-scope-btn${compareScope === "brand" ? " active" : ""}`}
                      onClick={() => setCompareScope("brand")}
                    >
                      Focus brand
                    </button>
                    <button
                      type="button"
                      className={`opt-scope-btn${compareScope === "manufacturer" ? " active" : ""}`}
                      onClick={() => setCompareScope("manufacturer")}
                    >
                      Manufacturer
                    </button>
                  </div>
                </div>
                {scenarioCompareData && pageActive ? (
                  <div className="opt-chart-block">
                    <div className="opt-chart-wrap opt-compare-chart-wrap">
                      <ScenarioCompareChart data={scenarioCompareData} embedded />
                    </div>
                  </div>
                ) : scenarioCompareData ? (
                  <p className="opt-section-sub opt-compare-empty">
                    Comparison chart paused while another section is open.
                  </p>
                ) : (
                  <p className="opt-section-sub opt-compare-empty">
                    Comparison metrics are not available for this run.
                  </p>
                )}
                {lastJobId && runResult.solution_status !== "infeasible" && (
                  <div className="opt-table-compare-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={openingSimulator || applyScenario.isPending}
                      onClick={() => void openOptimizedInSimulator()}
                    >
                      {openingSimulator ? "Opening…" : "Save & open in Simulator"}
                    </button>
                    <span className="opt-table-compare-hint">
                      Saves as{" "}
                      <b>
                        {focusBrand} {objectiveScenarioLabel(objective)} optimized
                      </b>
                    </span>
                    {openSimError && (
                      <span className="opt-note opt-note-warn">{openSimError}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {competitionRows.length > 0 && (
          <div className="opt-card opt-moves-panel opt-reaction-panel">
            <h2 className="opt-section-title">See a competitor price reaction?</h2>
            <p className="opt-section-sub">
              Pick a price change for one or more competitors. Apply and open the Simulator to see
              how the market reacts — saved to your scenario library as{" "}
              <b>Competitor +5%</b> (or whatever you choose).
            </p>
            <div className="opt-moves-scroll">
              <table className="opt-moves-table">
                <thead>
                  <tr>
                    <th>Competitor</th>
                    <th className="num">Switching share</th>
                    <th>Expected move</th>
                  </tr>
                </thead>
                <tbody>
                  {competitionRows.map((c) => (
                    <tr key={c.brand}>
                      <td>{c.brand}</td>
                      <td className="num">{fmt(c.share, 0)}%</td>
                      <td>
                        <select
                          className="opt-move-select"
                          value={reactionMoves[c.brand] ?? 0}
                          onChange={(e) =>
                            setReactionMoves((prev) => ({
                              ...prev,
                              [c.brand]: Number(e.target.value),
                            }))
                          }
                        >
                          <option value={-10}>-10%</option>
                          <option value={-5}>-5%</option>
                          <option value={0}>No change</option>
                          <option value={5}>+5%</option>
                          <option value={10}>+10%</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="opt-moves-actions">
              <button type="button" className="btn-primary">
                Recommend a reaction
              </button>
            </div>
            {reactionError && (
              <div className="opt-note opt-note-warn" role="alert">
                {reactionError}
              </div>
            )}
            <div className="opt-note">
              {reactionMoveList.length > 0 ? (
                <>
                  Will save as <b>{scenarioNameFromMoves(reactionMoveList)}</b>, starting from
                  base prices (not the recommendation above), then open it on the Simulator page.
                </>
              ) : (
                <>
                  Starts from base prices (not the recommendation above), applies the competitor
                  move(s), saves the scenario, and opens it on the Simulator page.
                </>
              )}
            </div>
          </div>
        )}
        
        {runResult?.menus && (
          <div className="opt-card opt-dev-box">
            <h3 className="opt-panel-title">Developer Debug: Menus</h3>
            <p className="opt-panel-sub">
              Candidate prices evaluated for each decision SKU.
            </p>
            <div className="opt-dev-menus">
              {Object.entries(runResult.menus).map(([sku, menu]) => (
                <div key={sku} className="opt-dev-menu-row">
                  <strong>{sku}</strong>
                  <div className="opt-dev-menu-prices">
                    {menu.map(p => {
                      const isRec = runResult.prices[sku] === p;
                      return (
                        <span key={p} className={isRec ? "opt-dev-price-rec" : "opt-dev-price"}>
                          {display.currencySymbol}
                          {p.toFixed(2)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
