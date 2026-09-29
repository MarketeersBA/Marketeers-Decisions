/** Typed payloads returned by GET /api/studies/{slug}/analytics/{type} */

export const ANALYTICS_TAB_IDS = [
  "elasticity",
  "price-index",
  "shares-revenues",
  "cross-brand",
  "som-sop",
  "fair-share",
  "validation",
  "introduction",
  "removal",
] as const;

export type AnalyticsTabId = (typeof ANALYTICS_TAB_IDS)[number];

export interface AnalyticsResponse<T = unknown> {
  type: AnalyticsTabId;
  slug: string;
  baseScenario: string | null;
  filters: { assignment_key: string; member: string }[];
  data: T;
}

export interface SomSopRow {
  name: string;
  som: number;
  sop: number;
}

export interface ElasticityRow {
  name: string;
  levels: Record<string, number>;
  mode?: "sku" | "group" | "company_sku" | "company_group";
}

export interface PriceIndexRow {
  name: string;
  values: Record<string, number>;
}

export interface PriceIndexData {
  columns: string[];
  rows: PriceIndexRow[];
  productName?: string;
  referenceProduct?: string;
}

export interface CrossBrandData {
  level?: "sku" | "group";
  groupType?: string;
  driverProduct?: string;
  products: string[];
  scenarios: Record<string, Record<string, number>>;
}

export interface FairShareRow {
  name: string;
  rebasedCurrentShare: number;
  newShare: number;
  actualShare: number;
  rebaseto100Wot: number;
  fairShare: number;
  index: number | null;
}

export interface ValidationRow {
  label: string;
  audit: number;
  rebased: number;
  delta: number;
}

export interface ValidationTable {
  title: string;
  seriesItem?: string;
  scenario?: string;
  rows: ValidationRow[];
}

export interface ValidationData {
  level: "sku" | "group";
  groupType: string;
  layout: "by_series" | "by_scenario";
  tables: ValidationTable[];
}

export interface IncrementalRow {
  productName: string;
  revenue: number;
  marketShare: number;
  /** Cumulative value share fraction 0–1 when incremental type is Value Share. */
  valueShare?: number;
  /** Weighted distribution 0–100 (product WD; Current = lineup average). */
  distribution?: number;
  /** Value sales unit (VSU) for Product Sales Rate = valueSales / WD. */
  valueSales?: number;
  revenueDelta: number;
  marketShareDelta: number;
  incrementalDelta?: number;
  mode?: "exclusive" | "cumulative";
  incrementalType?: "Revenue" | "Market Share" | "Value Share";
  error?: string;
}

export type AnalyticsTabData =
  | SomSopRow[]
  | ElasticityRow[]
  | PriceIndexData
  | CrossBrandData
  | FairShareRow[]
  | ValidationData
  | IncrementalRow[];

/** Stable string key for React Query — avoids refetch loops from new object references. */
export function serializeAnalyticsParams(
  params: Record<string, string | undefined>,
): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}
