import { describe, expect, it } from "vitest";

import type { GroupRow, ResultRow } from "../../api/types";
import {
  buildBrandSkuEfficiencyRows,
  buildOpportunityPrompt,
  buildSkuEfficiencyHeadline,
  inefficientOwnBrandNames,
} from "./ownBrandSkuEfficiencyUtils";

/** 19 SKUs so Toshiba (2) ≈ 10.5% SKU share with 13.7% value → efficient. */
const results: ResultRow[] = [
  { "Product Name": "Sam A", "Value Share": 20 },
  { "Product Name": "Sam B", "Value Share": 15 },
  { "Product Name": "Sam C", "Value Share": 8.5 },
  { "Product Name": "LG A", "Value Share": 15 },
  { "Product Name": "LG B", "Value Share": 8 },
  { "Product Name": "LG C", "Value Share": 4.3 },
  { "Product Name": "Tosh A", "Value Share": 10 },
  { "Product Name": "Tosh B", "Value Share": 3.7 },
  { "Product Name": "Torn A", "Value Share": 5 },
  { "Product Name": "Torn B", "Value Share": 4.5 },
  { "Product Name": "Sharp A", "Value Share": 1.2 },
  { "Product Name": "Sharp B", "Value Share": 1.2 },
  { "Product Name": "Sony A", "Value Share": 0.6 },
  { "Product Name": "Sony B", "Value Share": 0.5 },
  { "Product Name": "Fresh A", "Value Share": 0.7 },
  { "Product Name": "Fresh B", "Value Share": 0.7 },
  { "Product Name": "Jac A", "Value Share": 0.4 },
  { "Product Name": "Jac B", "Value Share": 0.3 },
  { "Product Name": "Jac C", "Value Share": 0.3 },
];

const groups: GroupRow[] = [
  {
    Name: "SAMSUNG",
    GroupType: "Brand",
    productNames: ["Sam A", "Sam B", "Sam C"],
    "N.Share": 0,
  },
  {
    Name: "LG",
    GroupType: "Brand",
    productNames: ["LG A", "LG B", "LG C"],
    "N.Share": 0,
  },
  {
    Name: "TOSHIBA",
    GroupType: "Brand",
    productNames: ["Tosh A", "Tosh B"],
    "N.Share": 0,
  },
  {
    Name: "TORNADO",
    GroupType: "Brand",
    productNames: ["Torn A", "Torn B"],
    "N.Share": 0,
  },
  {
    Name: "SHARP",
    GroupType: "Brand",
    productNames: ["Sharp A", "Sharp B"],
    "N.Share": 0,
  },
  {
    Name: "SONY",
    GroupType: "Brand",
    productNames: ["Sony A", "Sony B"],
    "N.Share": 0,
  },
  {
    Name: "FRESH",
    GroupType: "Brand",
    productNames: ["Fresh A", "Fresh B"],
    "N.Share": 0,
  },
  {
    Name: "JAC",
    GroupType: "Brand",
    productNames: ["Jac A", "Jac B", "Jac C"],
    "N.Share": 0,
  },
];

const OWN = ["Tosh A", "Tosh B", "Torn A", "Torn B", "Sony A", "Sony B"];

describe("buildBrandSkuEfficiencyRows", () => {
  it("computes SKU share from counts and index = skuShare / valueShare", () => {
    const rows = buildBrandSkuEfficiencyRows(groups, results, OWN);
    const total = 19;

    const samsung = rows.find((r) => r.brand === "SAMSUNG")!;
    expect(samsung.valueShare).toBeCloseTo(43.5, 5);
    expect(samsung.skuShare).toBeCloseTo((3 / total) * 100, 5);
    expect(samsung.indexPct).toBeCloseTo((samsung.skuShare / samsung.valueShare) * 100, 5);
    expect(samsung.efficient).toBe(true);
    expect(samsung.isOwn).toBe(false);

    const toshiba = rows.find((r) => r.brand === "TOSHIBA")!;
    expect(toshiba.valueShare).toBeCloseTo(13.7, 5);
    expect(toshiba.skuShare).toBeCloseTo((2 / total) * 100, 5);
    expect(toshiba.isOwn).toBe(true);
    expect(toshiba.efficient).toBe(true);

    const tornado = rows.find((r) => r.brand === "TORNADO")!;
    expect(tornado.isOwn).toBe(true);
    expect(tornado.efficient).toBe(false);

    const jac = rows.find((r) => r.brand === "JAC")!;
    expect(jac.skuShare).toBeCloseTo((3 / total) * 100, 5);
    expect(jac.efficient).toBe(false);
  });

  it("respects skuUniverse filter", () => {
    const rows = buildBrandSkuEfficiencyRows(
      groups,
      results,
      ["Tosh A"],
      ["Tosh A", "Tosh B", "Sony A"],
    );
    expect(rows).toHaveLength(2);
    const toshiba = rows.find((r) => r.brand === "TOSHIBA")!;
    expect(toshiba.skuCount).toBe(2);
    expect(toshiba.skuShare).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("sorts by value share descending", () => {
    const rows = buildBrandSkuEfficiencyRows(groups, results, []);
    expect(rows.map((r) => r.brand).slice(0, 4)).toEqual([
      "SAMSUNG",
      "LG",
      "TOSHIBA",
      "TORNADO",
    ]);
  });
});

describe("headlines", () => {
  it("builds own-brand efficiency headline", () => {
    const rows = buildBrandSkuEfficiencyRows(groups, results, OWN);
    expect(buildSkuEfficiencyHeadline(rows)).toBe(
      "Only TOSHIBA is efficient in its number of SKUs vs its Value Share",
    );
  });

  it("lists inefficient own brands for opportunity prompt", () => {
    const rows = buildBrandSkuEfficiencyRows(groups, results, OWN);
    const names = inefficientOwnBrandNames(rows);
    expect(names[0]).toBe("SONY");
    expect(names).toContain("TORNADO");
    expect(buildOpportunityPrompt(["TORNADO", "SHARP", "SONY"])).toMatch(
      /Brand Value OR Distribution/,
    );
  });
});
