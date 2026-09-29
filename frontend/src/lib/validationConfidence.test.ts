import { describe, expect, it } from "vitest";

import type { ValidationScore } from "../api/types";
import {
  CONFIDENCE_HIGH_MEAN_ABS_DELTA_PP,
  CONFIDENCE_HIGH_WMAPE,
  getRecommendationConfidence,
} from "./validationConfidence";

function score(overrides: Partial<ValidationScore>): ValidationScore {
  return {
    scenario: "test",
    hasAudit: true,
    meanAbsDeltaPp: 0.3,
    wmape: 3,
    maxAbsDeltaPp: 0.8,
    skuCount: 10,
    ...overrides,
  };
}

describe("getRecommendationConfidence", () => {
  it("returns High when mean and WMAPE are within thresholds", () => {
    expect(getRecommendationConfidence(score({}))).toBe("High");
    expect(
      getRecommendationConfidence(
        score({
          meanAbsDeltaPp: CONFIDENCE_HIGH_MEAN_ABS_DELTA_PP,
          wmape: CONFIDENCE_HIGH_WMAPE,
        }),
      ),
    ).toBe("High");
  });

  it("returns Low when mean delta exceeds threshold", () => {
    expect(
      getRecommendationConfidence(
        score({ meanAbsDeltaPp: CONFIDENCE_HIGH_MEAN_ABS_DELTA_PP + 0.01 }),
      ),
    ).toBe("Low");
  });

  it("returns Low when WMAPE exceeds threshold", () => {
    expect(
      getRecommendationConfidence(score({ wmape: CONFIDENCE_HIGH_WMAPE + 0.1 })),
    ).toBe("Low");
  });

  it("returns null without audit data", () => {
    expect(getRecommendationConfidence(score({ hasAudit: false }))).toBeNull();
  });
});
