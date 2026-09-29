import type { AnalyticsTabId } from "../../api/analytics_types";
import { BrandInteractionController } from "./controllers/BrandInteractionController";
import { ElasticityController } from "./controllers/ElasticityController";
import { FairShareController, getFairShareExportRows } from "./controllers/FairShareController";
import { IncrementalController, getIncrementalExportRows } from "./controllers/IncrementalController";
import {
  getPriceIndexControllerExportRows,
  PriceIndexController,
} from "./controllers/PriceIndexController";
import { getSharesRevenuesExportRows, SharesRevenuesController } from "./controllers/SharesRevenuesController";
import { getSomSopExportRows, SomSopController } from "./controllers/SomSopController";
import { getValidationExportRows, ValidationController } from "./controllers/ValidationController";
import type { AnalyticsControllerProps, AnalyticsTabDefinition } from "./types";
import { getCrossBrandExportRows, getElasticityExportRows } from "./utils";

function IntroductionController(props: AnalyticsControllerProps) {
  return <IncrementalController {...props} mode="introduction" />;
}

function RemovalController(props: AnalyticsControllerProps) {
  return <IncrementalController {...props} mode="removal" />;
}

export const ANALYTICS_TABS: AnalyticsTabDefinition[] = [
  {
    id: "elasticity",
    label: "Elasticity",
    Controller: ElasticityController,
    getExportRows: getElasticityExportRows,
  },
  {
    id: "price-index",
    label: "Price Index",
    Controller: PriceIndexController,
    getExportRows: getPriceIndexControllerExportRows,
  },
  {
    id: "shares-revenues",
    label: "Shares & Revenues",
    Controller: SharesRevenuesController,
    getExportRows: getSharesRevenuesExportRows,
  },
  {
    id: "cross-brand",
    label: "Brand Interaction",
    Controller: BrandInteractionController,
    getExportRows: getCrossBrandExportRows,
  },
  {
    id: "som-sop",
    label: "SoM vs SoP",
    Controller: SomSopController,
    getExportRows: getSomSopExportRows,
  },
  {
    id: "fair-share",
    label: "Fair Share",
    Controller: FairShareController,
    getExportRows: getFairShareExportRows,
  },
  {
    id: "validation",
    label: "Validation",
    Controller: ValidationController,
    getExportRows: getValidationExportRows,
  },
  {
    id: "introduction",
    label: "Introduction",
    Controller: IntroductionController,
    getExportRows: getIncrementalExportRows,
  },
  {
    id: "removal",
    label: "Removal",
    Controller: RemovalController,
    getExportRows: getIncrementalExportRows,
  },
];

export function getAnalyticsTab(id: AnalyticsTabId): AnalyticsTabDefinition {
  const tab = ANALYTICS_TABS.find((t) => t.id === id);
  if (!tab) throw new Error(`Unknown analytics tab: ${id}`);
  return tab;
}
