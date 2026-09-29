/**
 * Desktop Market Simulator colors N.Share by *relative* change vs B.Share
 * (confirmed from reference UI: ±threshold%, default 3.5 — not absolute pp).
 *
 * S.Index / R.Index in the Python engine are ratios (~1.0), so the same
 * threshold maps to 1 ± threshold/100 (e.g. 1.035 / 0.965).
 */

import type { ResultRow } from "../api/types";

export type ShareColorClass = "pos" | "neg" | "";
export type ShareColorThresholdMode = "fixed" | "sigma1";

/** @param thresholdPct Settings value in percent points, e.g. 3.5 meaning 3.5%. */
export function relativeShareColor(
  newShare: number,
  baseShare: number,
  thresholdPct: number,
): ShareColorClass {
  if (!baseShare || !Number.isFinite(newShare) || !Number.isFinite(baseShare)) {
    return "";
  }
  const rel = relativeChangeRate(newShare, baseShare);
  if (rel === null) return "";
  const thr = thresholdPct / 100;
  if (rel > thr) return "pos";
  if (rel < -thr) return "neg";
  return "";
}

/** Color an index stored as ratio (1.0 = unchanged). */
export function ratioIndexColor(index: number, thresholdPct: number): ShareColorClass {
  if (!Number.isFinite(index)) return "";
  const thr = thresholdPct / 100;
  if (index > 1 + thr) return "pos";
  if (index < 1 - thr) return "neg";
  return "";
}

export function relativeChangeRate(newShare: number, baseShare: number): number | null {
  if (!baseShare || !Number.isFinite(newShare) || !Number.isFinite(baseShare)) {
    return null;
  }
  return (newShare - baseShare) / baseShare;
}

function isSkuRow(row: ResultRow): boolean {
  const name = String(row["Product Name"] ?? "");
  if (name.startsWith("GROUP:")) return false;
  if (row["_placeholder"]) return false;
  return true;
}

/** Relative (N.Share − B.Share) / B.Share for each SKU row with valid shares. */
export function collectRelativeChangeRates(rows: ResultRow[]): number[] {
  const rates: number[] = [];
  for (const row of rows) {
    if (!isSkuRow(row)) continue;
    const base = row["B.Share"];
    const next = row["N.Share"];
    if (typeof base !== "number" || typeof next !== "number") continue;
    const rel = relativeChangeRate(next, base);
    if (rel !== null) rates.push(rel);
  }
  return rates;
}

export function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** One standard deviation of SKU relative change rates, in percent points. */
export function sigma1ThresholdPct(rows: ResultRow[]): number | null {
  const sigma = sampleStdDev(collectRelativeChangeRates(rows));
  return sigma !== null ? sigma * 100 : null;
}

export function resolveShareColorThreshold(
  mode: ShareColorThresholdMode,
  fixedPct: number,
  rows: ResultRow[],
): number {
  if (mode !== "sigma1") return fixedPct;
  const sigma = sigma1ThresholdPct(rows);
  return sigma != null && sigma > 0 ? sigma : fixedPct;
}
