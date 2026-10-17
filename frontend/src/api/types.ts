// Hand-written for Phase 0–1. Prefer generating from OpenAPI (see ROADMAP.md).

export interface StudyMetaDisplay {
  slug: string;
  study_name: string;
  price_currency_symbol: string;
  size_unit_label: string;
}

export interface StudyListItem {
  slug: string;
  name: string;
  company: string;
  status: "ready" | "incomplete";
  isDefault: boolean;
  createdAt: string;
  dataPeriod?: string;
  dataSource?: string;
}

export interface StudyDataSource {
  id: "design" | "hbu";
  initials: string;
  title: string;
  description: string;
  updatedAt?: string;
}

export interface StudyDataSourcesResponse {
  warnings?: string[];
  sources: StudyDataSource[];
}

export interface StudyContext {
  studyName: string;
  companyName: string;
  category?: string;
  market?: string;
  base?: string;
  products: number;
  respondents: number;
  financial: boolean;
  useGrouping: boolean;
  currencySymbol?: string;
  sizeUnitLabel?: string;
  activeSegment: string | null;
  filteredRespondents?: number;
}

export interface SegmentFilter {
  assignmentKey: string;
  member: string;
}

export interface SegmentationDimension {
  label: string;
  assignmentKey: string;
}

export interface SegmentationState {
  dimensions: SegmentationDimension[];
  membersByKey: Record<string, string[]>;
  active: SegmentFilter | null;
  activeFilters?: SegmentFilter[];
}

export interface Totals {
  total_n_share: number | null;
  total_revenue: number | null;
  total_value_share: number | null;
}

export type ResultRow = Record<string, RowValue>;

/** Scalar value stored in an editable cell or sent in a grid change. */
export type CellValue = string | number | boolean | null;

/** Any value that can appear on a results row (includes row metadata arrays). */
export type RowValue = string | number | boolean | string[] | null | undefined;

export interface GridChange {
  product: string;
  column: string;
  value: CellValue;
}

export interface AttrBound {
  lo: number;
  hi: number;
}

/** productName -> attributeName -> {lo, hi} */
export type AttributeBounds = Record<string, Record<string, AttrBound>>;

export interface GroupRow {
  Name: string;
  GroupType: string;
  productNames?: string[];
  "N.Share": number;
  "B.Share"?: number;
  "S.Index"?: number;
  "R.Index"?: number;
  "MM$"?: number;
  Revenue?: number;
  "Value Share"?: number;
  "Audit Share"?: number;
  [key: string]: any;
}

export interface SessionPayload {
  sessionId: string;
  slug: string;
  scenarioName: string;
  study: StudyContext;
  segmentation: SegmentationState;
  editableColumns: string[];
  columns: string[];
  /** Product names flagged as own (Company = 1 in the study product list). */
  companyProducts?: string[];
  results: ResultRow[];
  groups: GroupRow[];
  groupTypes: string[];
  totals: Totals;
  attributeBounds?: AttributeBounds;
  /** Discrete attribute column -> ordered level labels (for grid dropdowns). */
  discreteAttributeLevels?: Record<string, string[]>;
  changesApplied?: number;
  warnings?: string[];
}

export interface ScenarioListItem {
  name: string;
  description: string;
  validation: boolean;
  file?: string;
  created_at?: string;
}

export interface ScenarioImportPreview {
  name: string;
  description: string;
  productCount: number;
  includedCount: number;
  valid: boolean;
  error: string | null;
}

export interface ValidationScore {
  scenario: string;
  hasAudit: boolean;
  meanAbsDeltaPp: number | null;
  wmape: number | null;
  maxAbsDeltaPp: number | null;
  skuCount: number;
}

export interface ValidationWaveListItem {
  id: string;
  name: string;
  validation_date: string;
  notes?: string;
  source_filename?: string;
  created_at?: string;
}

export interface ValidationSeriesPoint {
  id: string;
  name: string;
  date: string;
  predicted: number;
  actual: number;
  meanAbsDeltaPp: number | null;
  wmape: number | null;
}

export interface ValidationBrandShare {
  name: string;
  /** Study-base volume share, rebased onto the validation audit total. */
  current: number;
  /** Audit share from the last uploaded validation wave. */
  validation: number;
}

export interface ValidationLatestBrands {
  id: string;
  name: string;
  date: string;
  brands: ValidationBrandShare[];
}

export interface ValidationSeriesData {
  metric: string;
  points: ValidationSeriesPoint[];
  /** Competitor-brand audit shares from the most recently uploaded wave. */
  latestBrands?: ValidationLatestBrands | null;
}

export interface ValidationWaveUploadResult {
  id: string;
  name: string;
  validationDate: string;
  notes: string;
  sourceFilename: string;
  createdAt: string;
  productCount: number;
}
