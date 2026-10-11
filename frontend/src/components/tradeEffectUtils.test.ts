import { describe, expect, it } from "vitest";

import { rollupSomSopByBrand } from "./tradeEffectUtils";

describe("rollupSomSopByBrand", () => {
  const groups = [
    { name: "Acme", productNames: ["Acme Cola", "Acme Zero"] },
    { name: "Rival", productNames: ["Rival Cola"] },
  ];

  it("sums SKU SoM and SoP onto the brand and flags own brands", () => {
    const points = rollupSomSopByBrand(
      [
        { name: "Acme Cola", som: 0.0625, sop: 0.0625 },
        { name: "Acme Zero", som: 0.0625, sop: 0.0625 },
        { name: "Rival Cola", som: 0.2, sop: 0.15 },
        { name: "Unmapped", som: 0.01, sop: 0.01 },
      ],
      groups,
      new Set(["Acme Cola"]),
    );

    expect(points).toEqual([
      { name: "Rival", som: 20, sop: 15, own: false },
      { name: "Acme", som: 12.5, sop: 12.5, own: true },
    ]);
  });
});
