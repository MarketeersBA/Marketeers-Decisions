import { useEffect } from "react";

import type { SomSopRow } from "../../../api/analytics_types";
import { AnalyticsSection } from "../AnalyticsSection";
import { AnalyticsTabLayout } from "../AnalyticsTabLayout";
import { SomSopChart } from "../charts";
import type { AnalyticsControllerProps } from "../types";
import { getArrayExportRows } from "../utils";

export function SomSopController({ data, isLoading, error, onParamsChange }: AnalyticsControllerProps) {
  useEffect(() => {
    onParamsChange({});
  }, [onParamsChange]);

  const rows = Array.isArray(data) ? (data as SomSopRow[]) : [];

  const controls = (
    <AnalyticsSection title="SoM vs SoP Global Configuration">
      <p className="analytics-hint">
        Uses current segmentation and base scenario. Each point is one included SKU.
      </p>
    </AnalyticsSection>
  );

  const output =
    rows.length > 0 ? (
      <SomSopChart data={rows} />
    ) : (
      <p className="analytics-empty">No SoM vs SoP data.</p>
    );

  return (
    <AnalyticsTabLayout
      title="SoM vs SoP"
      controls={controls}
      output={output}
      isLoading={isLoading}
      error={error}
    />
  );
}

export function getSomSopExportRows(data: unknown) {
  return getArrayExportRows(data);
}
