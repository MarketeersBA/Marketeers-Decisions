import type { CellValue, GridChange, ResultRow } from "../api/types";
import { asCellValue, isNumericEditableColumn, valuesEqual } from "./cellValue";

/** Diff local edit rows against the last server baseline (Streamlit Runner pattern). */
export function computeGridChanges(
  baseline: ResultRow[],
  edited: ResultRow[],
  editableColumns: string[] = [],
): GridChange[] {
  const changes: GridChange[] = [];
  if (!editableColumns || !Array.isArray(editableColumns)) return changes;
  for (let i = 0; i < edited.length; i++) {
    const product = String(edited[i]["Product Name"] ?? "");
    const baseRow = baseline[i];
    if (!baseRow) continue;
    for (const col of editableColumns) {
      const next = asCellValue(edited[i][col]);
      const base = asCellValue(baseRow[col]);
      if (next === undefined || base === undefined) continue;
      if (!valuesEqual(next, base)) {
        changes.push({ product, column: col, value: next });
      }
    }
  }
  return changes;
}

export function cloneRows(rows: ResultRow[]): ResultRow[] {
  return rows.map((r) => ({ ...r }));
}

/** True when a cell value is complete enough to send to recalculate (skip mid-typing). */
export function isRecalcReadyValue(column: string, value: CellValue): boolean {
  if (column === "Selected") return typeof value === "boolean";
  if (value === null || value === "") return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return false;
    if (!isNumericEditableColumn(column)) return true;
    if (s === "-" || s === "." || s.endsWith(".")) return false;
    if (s.endsWith("%")) return !Number.isNaN(Number(s.slice(0, -1)));
    return !Number.isNaN(Number(s));
  }
  return false;
}

export function readyGridChanges(changes: GridChange[]): GridChange[] {
  return changes.filter((c) => isRecalcReadyValue(c.column, c.value));
}

/** Overlay local editable diffs onto server rows (preserves mid-flight typing after recalc). */
export function applyGridChangesLocally(rows: ResultRow[], changes: GridChange[]): ResultRow[] {
  if (changes.length === 0) return rows;
  const next = cloneRows(rows);
  for (const change of changes) {
    const index = next.findIndex((r) => String(r["Product Name"]) === change.product);
    if (index >= 0) {
      next[index] = { ...next[index], [change.column]: change.value };
    }
  }
  return next;
}
