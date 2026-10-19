import { useMemo } from "react";

import { useValidationSeries } from "../api/hooks";
import {
  CONFIDENCE_HIGH_MEAN_ABS_DELTA_PP,
  CONFIDENCE_HIGH_WMAPE,
  getRecommendationConfidence,
  recommendationConfidenceLabel,
  validationScoreFromWavePoint,
} from "../lib/validationConfidence";
import { useSession } from "../stores/sessionStore";

function fmtPp(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

export function ValidationScoreChip() {
  const { session } = useSession();
  const slug = session?.slug;

  const { data: series, isLoading, isError } = useValidationSeries(slug);

  const latestWave = useMemo(() => {
    const points = series?.points ?? [];
    if (!points.length) return null;
    return points[points.length - 1];
  }, [series]);

  const score = useMemo(() => validationScoreFromWavePoint(latestWave), [latestWave]);
  const confidence = useMemo(() => getRecommendationConfidence(score), [score]);

  if (!session) return null;

  if (isLoading && !series) {
    return (
      <div className="validation-bar-chips">
        <span className="validation-score-chip loading">Validation…</span>
      </div>
    );
  }

  if (isError || !latestWave || !score) {
    return (
      <div className="validation-bar-chips">
        <span
          className="validation-score-chip muted"
          title="Upload validation workbooks on Data Hub & Trust"
        >
          No validation waves
        </span>
      </div>
    );
  }

  const title = [
    `Wave: ${latestWave.name}`,
    `Mean abs delta: ${fmtPp(score.meanAbsDeltaPp)} pp`,
    `WMAPE (audit-weighted): ${fmtPct(score.wmape)}%`,
    confidence
      ? `${recommendationConfidenceLabel(confidence)} (mean ≤ ${CONFIDENCE_HIGH_MEAN_ABS_DELTA_PP} pp & WMAPE ≤ ${CONFIDENCE_HIGH_WMAPE}%)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="validation-bar-chips">
      <span className="validation-score-chip" title={title}>
        Validation · {fmtPp(score.meanAbsDeltaPp)} pp avg Δ
      </span>
      {confidence ? (
        <span
          className={`validation-confidence-chip ${confidence === "High" ? "is-high" : "is-low"}`}
          title={title}
        >
          {recommendationConfidenceLabel(confidence)}
        </span>
      ) : null}
    </div>
  );
}
