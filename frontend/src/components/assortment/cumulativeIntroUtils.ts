import type { IncrementalRow } from "../../api/analytics_types";
import type { OptimizerSetup } from "../../api/optimizer_types";
import type { ResultRow } from "../../api/types";
import { buildBaseQueryParams } from "../analytics/utils";

export type ShareMetric = "market_share" | "value_share";

export type AssortmentRecommendation = "Keep" | "Watch" | "Push WD";

export interface IntroStep {
  step: number;
  productName: string;
  cumulativeSharePct: number;
  jumpPp: number;
  wd: number | null;
  vsu: number | null;
  psr: number | null;
  pushWd: boolean;
  pushLabel: string | null;
  recommendation: AssortmentRecommendation;
  why: string;
  error?: string;
}

export interface PushCriteriaOptions {
  wdGapPp?: number;
}

const COMPANY_PRODUCTS = "Company Products";

export function buildIntroQueryParams(
  setup: OptimizerSetup,
  groupType: string,
  groupMember: string,
  skus: string[],
): Record<string, string> {
  const params: Record<string, string> = {
    ...buildBaseQueryParams(setup),
    mode: "cumulative",
    incremental_type: "Value Share",
    intro_order: "sorted",
    group_type: groupType,
    products: skus.join(","),
    current_lineup: " ",
  };
  if (groupType !== COMPANY_PRODUCTS && groupMember) {
    params.group_member = groupMember;
  }
  return params;
}

export function parseIntroSteps(
  rows: IncrementalRow[],
  shareMetric: ShareMetric = "value_share",
): Array<
  Omit<IntroStep, "vsu" | "psr" | "pushWd" | "pushLabel" | "recommendation" | "why"> & {
    valueSales: number | null;
  }
> {
  let prevCumulative = 0;

  return rows
    .filter((row) => row.productName !== "Current")
    .map((row, index) => {
      const cumulativeSharePct =
        shareMetric === "value_share"
          ? (row.valueShare ?? row.marketShare) * 100
          : row.marketShare * 100;
      const jumpPp = cumulativeSharePct - prevCumulative;
      prevCumulative = cumulativeSharePct;

      return {
        step: index + 1,
        productName: row.productName,
        cumulativeSharePct,
        jumpPp,
        wd: row.distribution ?? null,
        valueSales: row.valueSales != null && row.valueSales > 0 ? row.valueSales : null,
        error: row.error,
      };
    });
}

function numFromRow(row: ResultRow, key: string): number | null {
  const raw = row[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.replace(/%/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function positiveNum(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function resultRowByProduct(
  byName: Map<string, ResultRow>,
  productName: string,
): ResultRow | undefined {
  if (byName.has(productName)) return byName.get(productName);
  const lower = productName.toLowerCase();
  for (const [key, row] of byName) {
    if (key.toLowerCase() === lower) return row;
  }
  return undefined;
}

/** PSR = this SKU's value share (pp) ÷ WD (%). */
export function computePsr(wd: number | null, valueSharePct: number | null): number | null {
  if (wd == null || wd <= 0) return null;
  if (valueSharePct == null || valueSharePct <= 0) return null;
  return valueSharePct / wd;
}

export function formatSharePct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatJumpPp(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "0.00";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

export function formatWd(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

export function formatPsr(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(4);
}

export function enrichWithSessionMetrics(
  steps: Array<
    Omit<IntroStep, "vsu" | "psr" | "pushWd" | "pushLabel" | "recommendation" | "why"> & {
      valueSales: number | null;
    }
  >,
  results: ResultRow[],
): IntroStep[] {
  const byName = new Map<string, ResultRow>();
  for (const row of results) {
    const name = row["Product Name"];
    if (typeof name === "string" && name) {
      byName.set(name, row);
    }
  }

  return steps.map((step) => {
    const row = resultRowByProduct(byName, step.productName);
    const sessionWd = positiveNum(row ? numFromRow(row, "New WD") : null);
    const sessionVsu = positiveNum(row ? numFromRow(row, "VSU") : null);

    // PSR uses only per-SKU value share from the intro API (jumpPp) and WD — no other fallbacks.
    const wd = positiveNum(step.wd) ?? sessionWd;
    const vsu = positiveNum(step.valueSales) ?? sessionVsu;
    const valueSharePct = positiveNum(step.jumpPp);
    const psr = computePsr(wd, valueSharePct);

    return {
      ...step,
      wd,
      vsu,
      psr,
      pushWd: false,
      pushLabel: null,
      recommendation: "Keep" as AssortmentRecommendation,
      why: "",
    };
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function computePushFlags(
  steps: IntroStep[],
  options: PushCriteriaOptions = {},
): IntroStep[] {
  const wdGapPp = options.wdGapPp ?? 10;
  if (steps.length === 0) return steps;

  const anchor = steps[0];
  const anchorWd = anchor.wd;
  const anchorName = anchor.productName;
  const validPsr = steps.map((s) => s.psr).filter((v): v is number => v != null && Number.isFinite(v));
  const medianPsr = median(validPsr);

  return steps.map((step) => {
    if (step.error) {
      return {
        ...step,
        pushWd: false,
        pushLabel: null,
        recommendation: "Watch",
        why: step.error,
      };
    }

    const canEvaluate =
      anchorWd != null &&
      step.wd != null &&
      step.psr != null &&
      medianPsr != null;

    const pushWd =
      canEvaluate &&
      step.psr! >= medianPsr! &&
      step.wd! < anchorWd! - wdGapPp;

    const pushLabel = pushWd
      ? step.step === 2 || step.productName !== anchorName
        ? `Push WD to match ${shortName(anchorName)}`
        : "Push — high PSR, low WD"
      : null;

    return {
      ...step,
      pushWd,
      pushLabel,
      recommendation: "Keep",
      why: "",
    };
  });
}

function shortName(name: string): string {
  if (name.length <= 28) return name;
  return `${name.slice(0, 26)}…`;
}

export function deriveRecommendations(steps: IntroStep[]): IntroStep[] {
  const validPsr = steps.map((s) => s.psr).filter((v): v is number => v != null && Number.isFinite(v));
  const medianPsr = median(validPsr);

  return steps.map((step) => {
    if (step.error) {
      return {
        ...step,
        recommendation: "Watch" as AssortmentRecommendation,
        why: step.error,
      };
    }

    if (!(step.jumpPp > 0.005)) {
      return {
        ...step,
        recommendation: "Watch" as AssortmentRecommendation,
        why: "No meaningful value share in introduction — not a Keep candidate",
      };
    }

    if (step.wd == null || !(step.wd > 0)) {
      return {
        ...step,
        recommendation: "Watch" as AssortmentRecommendation,
        why: "No WD — cannot evaluate distribution vs anchor",
      };
    }

    if (step.psr == null) {
      return {
        ...step,
        recommendation: "Watch" as AssortmentRecommendation,
        why: "Product Sales Rate unavailable — cannot evaluate efficiency",
      };
    }

    if (step.pushWd) {
      const gap =
        step.wd != null && steps[0]?.wd != null
          ? Math.round(steps[0].wd - step.wd)
          : null;
      return {
        ...step,
        recommendation: "Push WD",
        why:
          gap != null
            ? `High Product Sales Rate but WD ${gap} pp below anchor SKU`
            : step.pushLabel ?? "High Product Sales Rate with low WD vs anchor",
      };
    }

    if (medianPsr != null && step.psr < medianPsr) {
      return {
        ...step,
        recommendation: "Watch",
        why: "Low Product Sales Rate — poor return on additional WD",
      };
    }

    if (step.step === 1) {
      return {
        ...step,
        recommendation: "Keep",
        why: "Anchor SKU — first in introduction order",
      };
    }

    return {
      ...step,
      recommendation: "Keep",
      why: "In lineup; WD gap vs anchor within tolerance",
    };
  });
}

export function buildIntroSteps(
  rows: IncrementalRow[],
  results: ResultRow[],
  shareMetric: ShareMetric = "value_share",
): IntroStep[] {
  const parsed = parseIntroSteps(rows, shareMetric);
  const enriched = enrichWithSessionMetrics(parsed, results);
  const withPush = computePushFlags(enriched);
  return deriveRecommendations(withPush);
}

export function findMaxJumpStep(steps: IntroStep[]): IntroStep | null {
  if (steps.length === 0) return null;
  return steps.reduce((best, step) => (step.jumpPp > best.jumpPp ? step : best), steps[0]);
}

export function buildHeadline(steps: IntroStep[]): string | null {
  const pushSkus = steps.filter((s) => s.pushWd);
  if (pushSkus.length === 0) return null;

  const labels = pushSkus.map((s) => shortLabel(s.productName));
  if (labels.length === 1) {
    return `${labels[0]} is recommended to increase WD`;
  }
  if (labels.length === 2) {
    return `${labels[0]} & ${labels[1]} are recommended to increase WD`;
  }
  const last = labels.pop();
  return `${labels.join(", ")} & ${last} are recommended to increase WD`;
}

function shortLabel(name: string): string {
  const inch = name.match(/(\d+)\s*"/);
  if (inch) return `${inch[1]}"`;
  const words = name.split(/\s+/);
  if (words.length <= 3) return name;
  return words.slice(-2).join(" ");
}

export type ShareCoverage = "all" | 80 | 90 | 95;

/** SKUs in intro order until cumulative reaches `cutoffPct` of the lineup total. */
export function stepsThroughShareCutoff(steps: IntroStep[], cutoffPct: number): IntroStep[] {
  if (steps.length === 0) return steps;
  const total = steps[steps.length - 1].cumulativeSharePct;
  if (!(total > 0) || !(cutoffPct > 0)) return steps;
  const target = total * (cutoffPct / 100);
  const idx = steps.findIndex((step) => step.cumulativeSharePct + 1e-9 >= target);
  return steps.slice(0, (idx < 0 ? steps.length : idx + 1));
}

export function toChartData(steps: IntroStep[]) {
  const lastRaw = steps.length > 0 ? steps[steps.length - 1].cumulativeSharePct : 0;
  const scale = lastRaw > 0 ? 100 / lastRaw : 1;

  return steps.map((step, index) => {
    const rawCumulativeSharePct = step.cumulativeSharePct;
    const cumulativeSharePct =
      index === steps.length - 1 && steps.length > 0 ? 100 : rawCumulativeSharePct * scale;
    const stepShare = step.jumpPp * scale;
    const priorShare = Math.max(0, cumulativeSharePct - stepShare);
    return {
      ...step,
      name: step.productName,
      priorShare,
      stepShare,
      rawCumulativeSharePct,
      cumulativeSharePct,
      wd: step.wd ?? 0,
      psr: step.psr,
    };
  });
}

export function canShowPsr(steps: IntroStep[]): boolean {
  return steps.some((s) => s.psr != null && Number.isFinite(s.psr) && s.psr > 0);
}
