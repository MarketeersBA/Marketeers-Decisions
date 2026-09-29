import { describe, expect, it } from "vitest";

import {
  fmtPerUnitPrice,
  fmtPrice,
  perUnitLabel,
  resolveUnitField,
  unitSelectState,
  CUSTOM_SELECT_VALUE,
} from "./studyDisplay";

describe("studyDisplay", () => {
  it("formats price with symbol", () => {
    expect(fmtPrice(12.5, "SAR")).toBe("SAR12.50");
    expect(fmtPrice(null, "$")).toBe("—");
  });

  it("builds per-unit label and price", () => {
    expect(perUnitLabel("€", "L")).toBe("€/L");
    expect(fmtPerUnitPrice(2.5, "$", "kg")).toBe("$2.50/kg");
  });

  it("resolves custom unit fields", () => {
    expect(
      resolveUnitField(CUSTOM_SELECT_VALUE, "  ر.س ", ["€"], "€"),
    ).toBe("ر.س");
    expect(resolveUnitField("$", "", ["$"], "€")).toBe("$");
  });

  it("initializes select state from stored values", () => {
    expect(unitSelectState("€", ["€", "$"], "€")).toEqual({ select: "€", custom: "" });
    expect(unitSelectState("kg", ["L", "kg"], "L")).toEqual({
      select: "kg",
      custom: "",
    });
    expect(unitSelectState("oz", ["L"], "L")).toEqual({
      select: CUSTOM_SELECT_VALUE,
      custom: "oz",
    });
  });
});
