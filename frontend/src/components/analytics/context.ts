/** Shared study/session context passed to every analytics tab controller. */

import type { ScenarioListItem } from "../../api/types";

export interface AnalyticsContext {
  productNames: string[];
  groupTypes: string[];
  groupMembers: string[];
  groupType: string;
  setGroupType: (value: string) => void;
  scenarios: ScenarioListItem[];
}
