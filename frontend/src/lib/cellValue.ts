import type { CellValue, RowValue } from "../api/types";

/** Scalar grid cell contents (editable columns and change payloads). */
export function asCellValue(raw: RowValue): CellValue | undefined {
  if (Array.isArray(raw)) return undefined;
  if (raw === undefined) return null;
  return raw;
}

export function valuesEqual(a: RowValue, b: RowValue): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return String(a ?? "") === String(b ?? "");
}

/** Columns edited as numbers (conditional attrs, financial toggles). */
export function isNumericEditableColumn(column: string): boolean {
  return column.startsWith("New ") || column === "NOS" || column === "TDC";
}

export function isDiscreteEditableColumn(
  column: string,
  discreteLevels?: Record<string, string[]>,
): boolean {
  return Boolean(discreteLevels && discreteLevels[column]?.length);
}

/** Resolve a stored level index (1-based) or label to a display label. */
export function formatDiscreteCellValue(raw: RowValue, levels: string[]): string {
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (levels.includes(trimmed)) return trimmed;
  }
  const idx = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(idx) && idx >= 1 && idx <= levels.length) {
    return levels[idx - 1];
  }
  return String(raw);
}

/** Current 1-based level index for a discrete cell value. */
export function discreteLevelIndex(raw: RowValue, levels: string[]): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const byLabel = levels.indexOf(trimmed);
    if (byLabel >= 0) return byLabel + 1;
  }
  const idx = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(idx) && idx >= 1 && idx <= levels.length) return idx;
  return null;
}

export function parseCellInput(raw: string, column: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!isNumericEditableColumn(column)) return trimmed;
  const num = Number(trimmed);
  return !Number.isNaN(num) ? num : trimmed;
}
