import type { ValidationScore, ValidationSeriesPoint } from "../api/types";

export type RecommendationConfidence = "High" | "Low";

/** Mean abs delta (pp) at or below this → contributes to High confidence. */
export const CONFIDENCE_HIGH_MEAN_ABS_DELTA_PP = 0.5;

/** WMAPE (%) at or below this → contributes to High confidence. */
export const CONFIDENCE_HIGH_WMAPE = 5;

/** Latest Data Hub validation wave → score shape for confidence helpers. */
export function validationScoreFromWavePoint(
  point: ValidationSeriesPoint | null | undefined,
): ValidationScore | null {
  if (!point || point.meanAbsDeltaPp == null || point.wmape == null) {
    return null;
  }
  return {
    scenario: point.name,
    hasAudit: true,
    meanAbsDeltaPp: point.meanAbsDeltaPp,
    wmape: point.wmape,
    maxAbsDeltaPp: point.meanAbsDeltaPp,
    skuCount: 0,
  };
}

export function getRecommendationConfidence(
  score: ValidationScore | null | undefined,
): RecommendationConfidence | null {
  if (!score?.hasAudit) return null;
  if (score.meanAbsDeltaPp == null || score.wmape == null) return null;

  const meanOk = score.meanAbsDeltaPp <= CONFIDENCE_HIGH_MEAN_ABS_DELTA_PP;
  const wmapeOk = score.wmape <= CONFIDENCE_HIGH_WMAPE;
  return meanOk && wmapeOk ? "High" : "Low";
}

export function recommendationConfidenceLabel(level: RecommendationConfidence): string {
  return `Recommendation Confidence: ${level}`;
}
