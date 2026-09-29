import type { OptimizerSetup } from "../../api/optimizer_types";
import type {
  CrossBrandData,
  ElasticityRow,
  PriceIndexData,
  ValidationData,
} from "../../api/analytics_types";

export const CHART_COLORS = [
  "#C41230",
  "#002D62",
  "#1A6B4A",
  "#8B1E32",
  "#0A3D7A",
  "#C9A227",
  "#5C6B80",
  "#6B7280",
];

export function fmtPct(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtNum(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function buildBaseQueryParams(setup: OptimizerSetup): Record<string, string> {
  const p: Record<string, string> = {};
  if (setup.base_scenario) p.base_scenario = setup.base_scenario;
  if (setup.filters && setup.filters.length > 0) {
    p.filters = JSON.stringify(setup.filters);
  }
  return p;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(",")];
  for (const row of rows) {
    lines.push(keys.map((k) => JSON.stringify(row[k] ?? "")).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function isRevenueRow(name: string): boolean {
  return name.toLowerCase().includes("revenue");
}

export function getElasticityExportRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return (data as ElasticityRow[]).map((r) => ({ name: r.name, ...r.levels }));
}

export function getPriceIndexExportRows(data: unknown): Record<string, unknown>[] {
  if (!data || Array.isArray(data)) return [];
  const pi = data as PriceIndexData;
  return pi.rows.map((r) => ({ name: r.name, ...r.values }));
}

export function getCrossBrandExportRows(data: unknown): Record<string, unknown>[] {
  if (!data || Array.isArray(data)) return [];
  const cb = data as CrossBrandData;
  return cb.products.map((name) => {
    const row: Record<string, unknown> = { name };
    for (const [sc, vals] of Object.entries(cb.scenarios)) {
      row[sc] = vals[name];
    }
    return row;
  });
}

export function getArrayExportRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data as Record<string, unknown>[];
}

export function getFairShareExportRows(data: unknown): Record<string, unknown>[] {
  return getArrayExportRows(data);
}

export function getValidationExportRows(data: unknown): Record<string, unknown>[] {
  if (!data || Array.isArray(data)) return [];
  const payload = data as ValidationData;
  const out: Record<string, unknown>[] = [];
  for (const table of payload.tables ?? []) {
    for (const row of table.rows) {
      out.push({ table: table.title, ...row });
    }
  }
  return out;
}

export function getIncrementalExportRows(data: unknown): Record<string, unknown>[] {
  return getArrayExportRows(data);
}
