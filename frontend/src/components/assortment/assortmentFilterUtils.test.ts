import { describe, expect, it } from "vitest";

import type { GroupRow, ResultRow } from "../../api/types";
import {
  filterScopedSkus,
  filterStandaloneOfferSkus,
  filterStandaloneOfferSkusFromMap,
  skusMatchingAttribute,
} from "./assortmentFilterUtils";

const results: ResultRow[] = [
  { "Product Name": "TOSHIBA 55 SMART", SMART: 2 },
  { "Product Name": "TOSHIBA 43 BASIC", SMART: 1 },
  { "Product Name": "SAMSUNG 55 SMART", SMART: 2 },
];

const discreteLevels = {
  SMART: ["NON-SMART", "SMART"],
};

function mockGroup(
  Name: string,
  productNames: string[],
  GroupType = "test",
): GroupRow {
  return { Name, GroupType, productNames, "N.Share": 0 };
}

describe("skusMatchingAttribute", () => {
  it("matches discrete attributes by level label (grid stores 1-based index)", () => {
    expect(skusMatchingAttribute(results, "SMART", "SMART", discreteLevels)).toEqual([
      "TOSHIBA 55 SMART",
      "SAMSUNG 55 SMART",
    ]);
    expect(skusMatchingAttribute(results, "SMART", "NON-SMART", discreteLevels)).toEqual([
      "TOSHIBA 43 BASIC",
    ]);
  });

  it("matches case-insensitive attribute column names", () => {
    expect(skusMatchingAttribute(results, "smart", "SMART", discreteLevels)).toEqual([
      "TOSHIBA 55 SMART",
      "SAMSUNG 55 SMART",
    ]);
  });
});

describe("filterScopedSkus", () => {
  it("intersects brand SKUs with cross-filter attribute matches", () => {
    const baseSkus = ["TOSHIBA 55 SMART", "TOSHIBA 43 BASIC"];
    const scoped = filterScopedSkus(
      baseSkus,
      { SMART: "SMART" },
      {},
      results,
      discreteLevels,
    );
    expect(scoped).toEqual(["TOSHIBA 55 SMART"]);
  });

  it("prefers study group membership when productNames are present", () => {
    const groupsByType: Record<string, GroupRow[]> = {
      SMART: [mockGroup("SMART", ["TOSHIBA 55 SMART"], "SMART")],
    };
    const scoped = filterScopedSkus(
      ["TOSHIBA 55 SMART", "TOSHIBA 43 BASIC"],
      { SMART: "SMART" },
      groupsByType,
      results,
      discreteLevels,
    );
    expect(scoped).toEqual(["TOSHIBA 55 SMART"]);
  });
});

describe("filterStandaloneOfferSkus", () => {
  const groupsByType: Record<string, GroupRow[]> = {
    "Offer Type": [
      mockGroup("Standalone", ["SKU A", "SKU B"], "Offer Type"),
      mockGroup("Bundle", ["SKU A + SKU B"], "Offer Type"),
    ],
  };

  it("keeps only Standalone SKUs when Offer Type groups exist", () => {
    expect(
      filterStandaloneOfferSkus(["SKU A", "SKU B", "SKU A + SKU B"], groupsByType),
    ).toEqual(["SKU A", "SKU B"]);
  });

  it("passes through all SKUs when Offer Type groups are absent", () => {
    expect(filterStandaloneOfferSkus(["SKU A", "SKU A + SKU B"], {})).toEqual([
      "SKU A",
      "SKU A + SKU B",
    ]);
  });
});

describe("filterStandaloneOfferSkusFromMap", () => {
  const groupsByType = {
    "Offer Type": {
      Standalone: ["SKU A"],
      Bundle: ["SKU A + SKU B"],
    },
  };

  it("keeps only Standalone SKUs from optimizer context map", () => {
    expect(
      filterStandaloneOfferSkusFromMap(["SKU A", "SKU A + SKU B"], groupsByType),
    ).toEqual(["SKU A"]);
  });
});
