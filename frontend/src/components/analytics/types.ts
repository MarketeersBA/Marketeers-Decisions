import type { ComponentType } from "react";

import type { AnalyticsTabId } from "../../api/analytics_types";
import type { OptimizerSetup } from "../../api/optimizer_types";
import type { AnalyticsContext } from "./context";

export interface AnalyticsControllerProps {
  context: AnalyticsContext;
  setup: OptimizerSetup;
  data: unknown;
  isLoading: boolean;
  error: Error | null;
  onParamsChange: (params: Record<string, string>) => void;
}

export type ExportRowsFn = (data: unknown) => Record<string, unknown>[];

export interface AnalyticsTabDefinition {
  id: AnalyticsTabId;
  label: string;
  Controller: ComponentType<AnalyticsControllerProps>;
  getExportRows: ExportRowsFn;
}
