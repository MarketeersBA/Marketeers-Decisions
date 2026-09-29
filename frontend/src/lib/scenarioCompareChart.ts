import type { ResultRow } from "../api/types";

export interface ScenarioComparePoint {
  scenario: string;
  volShare: number;
  valShare: number;
  revIndex: number;
}

export function axisTicks(min: number, max: number, include?: number, maxTicks = 6): number[] {
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

/** Estimate base value share from current row metrics (B.Share / N.Share scaling). */
function baseValueShareEstimate(row: ResultRow): number {
  const val = Number(row["Value Share"]);
  const b = Number(row["B.Share"]);
  const n = Number(row["N.Share"]);
  if (!Number.isFinite(val)) return 0;
  if (!Number.isFinite(n) || n <= 1e-9) return 0;
  if (!Number.isFinite(b)) return val;
  return val * (b / n);
}

export function aggregateManufacturerScope(
  rows: ResultRow[],
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
    const name = String(row["Product Name"] ?? "");
    if (!skuNames.has(name)) continue;
    if (row["Selected"] === false) continue;

    baseVol += Number(row["B.Share"]) || 0;
    newVol += Number(row["N.Share"]) || 0;
    baseVal += baseValueShareEstimate(row);
    newVal += Number(row["Value Share"]) || 0;

    const rev = Number(row["Revenue"]);
    const rIndex = Number(row["R.Index"]);
    if (Number.isFinite(rev)) {
      newRev += rev;
      if (Number.isFinite(rIndex) && rIndex > 1e-9) {
        baseRev += rev / rIndex;
      }
    }
  }

  return { baseVol, newVol, baseVal, newVal, baseRev, newRev };
}

/** Engine stores R.Index as a ratio (~1.0). Charts/KPIs use base = 100. */
export function ratioToIndex(rIndex: number): number {
  if (!Number.isFinite(rIndex) || rIndex <= 0) return 0;
  return rIndex * 100;
}

/** Weighted revenue index for a SKU scope (do not sum R.Index). */
export function scopeRevenueIndex(rows: ResultRow[], skuNames: Set<string>): number {
  const agg = aggregateManufacturerScope(rows, skuNames);
  return agg.baseRev > 1e-9 ? (agg.newRev / agg.baseRev) * 100 : 100;
}

export function toScenarioComparePoints(
  baseVol: number,
  newVol: number,
  baseVal: number,
  newVal: number,
  baseRev: number,
  newRev: number,
  currentLabel: string,
): ScenarioComparePoint[] {
  const revIndex = baseRev > 1e-9 ? (newRev / baseRev) * 100 : 100;
  return [
    {
      scenario: "Base",
      volShare: Number(baseVol.toFixed(2)),
      valShare: Number(baseVal.toFixed(2)),
      revIndex: 100,
    },
    {
      scenario: currentLabel,
      volShare: Number(newVol.toFixed(2)),
      valShare: Number(newVal.toFixed(2)),
      revIndex: Number(revIndex.toFixed(1)),
    },
  ];
}
