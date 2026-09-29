const DEFAULT_DECIMALS = 2;

/** Grid columns shown as whole numbers (no fractional digits). */
const WHOLE_NUMBER_COLUMNS = new Set(["Value Share", "VSU", "Revenue"]);

export function columnDecimals(col: string, defaultDecimals = DEFAULT_DECIMALS): number {
  return WHOLE_NUMBER_COLUMNS.has(col) ? 0 : defaultDecimals;
}

export function fmtNumber(value: unknown, decimals = DEFAULT_DECIMALS): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function isNumericColumn(col: string): boolean {
  return !["Product Name", "Selected", "ProductType", "Group"].includes(col);
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
