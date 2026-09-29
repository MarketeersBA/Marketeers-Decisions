import { describe, expect, it } from "vitest";

import type { IncrementalRow } from "../../api/analytics_types";
import type { ResultRow } from "../../api/types";
import {
  buildHeadline,
  buildIntroSteps,
  computePsr,
  computePushFlags,
  deriveRecommendations,
  enrichWithSessionMetrics,
  formatJumpPp,
  formatPsr,
  formatSharePct,
  formatWd,
  parseIntroSteps,
  stepsThroughShareCutoff,
  toChartData,
} from "./cumulativeIntroUtils";

const sampleRows: IncrementalRow[] = [
  {
    productName: "Current",
    revenue: 0,
    marketShare: 0,
    distribution: 0,
    revenueDelta: 0,
    marketShareDelta: 0,
    incrementalDelta: 0,
    mode: "cumulative",
    incrementalType: "Market Share",
  },
  {
    productName: "SKU Anchor 32",
    revenue: 100,
    marketShare: 0.53,
    distribution: 92,
    valueSales: 239.2,
    revenueDelta: 0,
    marketShareDelta: 0.53,
    incrementalDelta: 0.53,
    mode: "cumulative",
  },
  {
    productName: "SKU Full HD 43",
    revenue: 180,
    marketShare: 0.94,
    distribution: 70,
    valueSales: 170,
    revenueDelta: 0,
    marketShareDelta: 0.41,
    incrementalDelta: 0.41,
    mode: "cumulative",
  },
  {
    productName: "SKU Full HD 49",
    revenue: 190,
    marketShare: 0.99,
    distribution: 58,
    valueSales: 34.8,
    revenueDelta: 0,
    marketShareDelta: 0.01,
    incrementalDelta: 0.01,
    mode: "cumulative",
  },
  {
    productName: "SKU Full HD 50",
    revenue: 200,
    marketShare: 1,
    distribution: 80,
    valueSales: 155,
    revenueDelta: 0,
    marketShareDelta: 0.01,
    incrementalDelta: 0.01,
    mode: "cumulative",
  },
];

const sampleResults: ResultRow[] = [
  { "Product Name": "SKU Anchor 32", "Value Share": 30.0, "New WD": 92, VSU: 2760 },
  { "Product Name": "SKU Full HD 43", "Value Share": 21.0, "New WD": 70, VSU: 1680 },
  { "Product Name": "SKU Full HD 49", "Value Share": 5.8, "New WD": 58, VSU: 336.4 },
  { "Product Name": "SKU Full HD 50", "Value Share": 24.0, "New WD": 80, VSU: 1920 },
];

describe("parseIntroSteps", () => {
  it("skips Current and maps cumulative share and jump", () => {
    const steps = parseIntroSteps(sampleRows);
    expect(steps).toHaveLength(4);
    expect(steps[0].productName).toBe("SKU Anchor 32");
    expect(steps[0].cumulativeSharePct).toBeCloseTo(53);
    expect(steps[1].jumpPp).toBeCloseTo(41);
  });

  it("uses valueShare when column metric is value share", () => {
    const valueRows: IncrementalRow[] = [
      ...sampleRows.slice(0, 1),
      {
        ...sampleRows[1],
        valueShare: 0.61,
        incrementalDelta: 0.61,
      },
    ];
    const steps = parseIntroSteps(valueRows, "value_share");
    expect(steps[0].cumulativeSharePct).toBeCloseTo(61);
    expect(steps[0].jumpPp).toBeCloseTo(61);
  });
});

describe("enrichWithSessionMetrics", () => {
  it("computes PSR as intro jumpPp (value share) / WD", () => {
    const parsed = parseIntroSteps(sampleRows);
    const enriched = enrichWithSessionMetrics(parsed, sampleResults);
    expect(enriched[0].psr).toBeCloseTo(53 / 92, 4);
    expect(enriched[1].psr).toBeCloseTo(41 / 70, 4);
  });

  it("returns null PSR when intro value share (jumpPp) is missing", () => {
    const rowsNoJump: IncrementalRow[] = [
      sampleRows[0],
      {
        ...sampleRows[1],
        valueShare: 0,
        incrementalDelta: 0,
        marketShare: 0,
        marketShareDelta: 0,
      },
    ];
    const parsed = parseIntroSteps(rowsNoJump, "value_share");
    const enriched = enrichWithSessionMetrics(parsed, sampleResults);
    expect(enriched[0].psr).toBeNull();
  });

  it("uses intro WD with session fallback only for the denominator", () => {
    const rowsNoWd = sampleRows.map((row) =>
      row.productName === "Current" ? row : { ...row, distribution: undefined },
    );
    const parsed = parseIntroSteps(rowsNoWd);
    const enriched = enrichWithSessionMetrics(parsed, sampleResults);
    expect(enriched[0].psr).toBeCloseTo(53 / 92, 4);
  });
});

describe("computePsr", () => {
  it("uses value share over WD only", () => {
    expect(computePsr(80, 5)).toBeCloseTo(5 / 80);
    expect(computePsr(80, null)).toBeNull();
    expect(computePsr(0, 5)).toBeNull();
  });
});

describe("table formatters", () => {
  it("keeps two decimal places for share, jump, and WD", () => {
    expect(formatSharePct(10.04)).toBe("10.04%");
    expect(formatJumpPp(0.04)).toBe("+0.04");
    expect(formatJumpPp(0)).toBe("0.00");
    expect(formatWd(0.32)).toBe("0.32%");
    expect(formatPsr(0.04 / 0.32)).toBe("0.1250");
    expect(formatPsr(null)).toBe("—");
  });
});

describe("computePushFlags", () => {
  it("flags SKUs with high PSR and WD below anchor minus gap", () => {
    const parsed = parseIntroSteps(sampleRows);
    const enriched = enrichWithSessionMetrics(parsed, sampleResults);
    const withPush = computePushFlags(enriched, { wdGapPp: 10 });

    expect(withPush[0].pushWd).toBe(false);
    expect(withPush[1].pushWd).toBe(true);
    expect(withPush[2].pushWd).toBe(false);
    expect(withPush[3].pushWd).toBe(false);
  });
});

describe("deriveRecommendations", () => {
  it("maps push, watch, and keep statuses", () => {
    const steps = buildIntroSteps(sampleRows, sampleResults);
    expect(steps[0].recommendation).toBe("Keep");
    expect(steps[1].recommendation).toBe("Push WD");
    expect(steps[2].recommendation).toBe("Watch");
    expect(steps[3].recommendation).toBe("Watch");
  });

  it("marks zero-jump SKUs as Watch instead of Keep within tolerance", () => {
    const rows: IncrementalRow[] = [
      sampleRows[0],
      sampleRows[1],
      {
        ...sampleRows[2],
        productName: "SKU Zero Jump",
        marketShare: 0.53,
        marketShareDelta: 0,
        incrementalDelta: 0,
        distribution: 0,
        valueSales: 0,
      },
    ];
    const steps = buildIntroSteps(rows, sampleResults);
    const zero = steps.find((s) => s.productName === "SKU Zero Jump");
    expect(zero?.recommendation).toBe("Watch");
    expect(zero?.why).toMatch(/No meaningful value share/i);
  });

  it("marks SKUs with no WD as Watch", () => {
    const rows: IncrementalRow[] = [
      sampleRows[0],
      {
        ...sampleRows[1],
        productName: "SKU No WD",
        distribution: 0,
        marketShare: 0.2,
        marketShareDelta: 0.2,
        incrementalDelta: 0.2,
        valueSales: 50,
      },
    ];
    const steps = buildIntroSteps(rows, []);
    const noWd = steps.find((s) => s.productName === "SKU No WD");
    expect(noWd?.recommendation).toBe("Watch");
    expect(noWd?.why).toMatch(/No WD/i);
  });
});

describe("toChartData", () => {
  it("scales columns so the last bar is 100%", () => {
    const steps = buildIntroSteps(sampleRows, sampleResults);
    const chartData = toChartData(steps);
    expect(chartData[chartData.length - 1].cumulativeSharePct).toBe(100);
    expect(chartData[0].cumulativeSharePct).toBeLessThan(100);
    expect(chartData[0].rawCumulativeSharePct).toBeCloseTo(steps[0].cumulativeSharePct);
  });
});

describe("stepsThroughShareCutoff", () => {
  it("keeps SKUs until cumulative reaches the cutoff of total value share", () => {
    const steps = buildIntroSteps(sampleRows, sampleResults);
    const half = stepsThroughShareCutoff(steps, 50);
    const lastHalf = half[half.length - 1];
    const total = steps[steps.length - 1].cumulativeSharePct;
    expect(lastHalf.cumulativeSharePct).toBeGreaterThanOrEqual(total * 0.5);
    expect(half.length).toBeLessThan(steps.length);

    const eighty = stepsThroughShareCutoff(steps, 80);
    expect(eighty[eighty.length - 1].cumulativeSharePct).toBeGreaterThanOrEqual(total * 0.8);
    expect(eighty.length).toBeGreaterThanOrEqual(half.length);
  });
});

describe("buildHeadline", () => {
  it("builds headline for multiple push SKUs", () => {
    const steps = buildIntroSteps(sampleRows, sampleResults);
    const headline = buildHeadline(steps);
    expect(headline).toContain("recommended to increase WD");
    expect(headline).toContain("HD 43");
  });

  it("returns null when no push SKUs", () => {
    const parsed = parseIntroSteps(sampleRows.slice(0, 2));
    const enriched = enrichWithSessionMetrics(parsed, sampleResults.slice(0, 1));
    const withPush = computePushFlags(enriched);
    const recs = deriveRecommendations(withPush);
    expect(buildHeadline(recs)).toBeNull();
  });
});
