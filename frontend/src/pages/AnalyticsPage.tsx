import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import type { AnalyticsTabId } from "../api/analytics_types";
import { useAnalytics, useScenarios } from "../api/hooks";
import { buildOptimizerSetup } from "../api/optimizer_types";
import type { ResultRow } from "../api/types";
import {
  ANALYTICS_TABS,
  buildBaseQueryParams,
  downloadCsv,
  getAnalyticsTab,
} from "../components/analytics";
import type { AnalyticsContext } from "../components/analytics/context";
import { useSession } from "../stores/sessionStore";
import "./pages.css";

export function AnalyticsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { session } = useSession();
  const studySlug = slug ?? session?.slug;
  const [tab, setTab] = useState<AnalyticsTabId>("som-sop");
  const [baseScenario, setBaseScenario] = useState("");
  const [tabParams, setTabParams] = useState<Record<string, string>>({});
  const [groupType, setGroupType] = useState("Brand");

  const { data: scenarios = [] } = useScenarios(studySlug);
  const setup = useMemo(
    () => buildOptimizerSetup(session?.segmentation, baseScenario || null),
    [session?.segmentation, baseScenario],
  );

  const productNames = useMemo(() => {
    const rows = (session?.results ?? []) as ResultRow[];
    const out = new Set<string>();
    for (const row of rows) {
      const name = row["Product Name"];
      if (typeof name === "string" && name) out.add(name);
    }
    return [...out];
  }, [session?.results]);

  const groupRows = session?.groups ?? [];
  const groupTypes = session?.groupTypes ?? ["Brand"];
  const groupMembers = useMemo(() => {
    return groupRows
      .filter((g) => g.GroupType === groupType)
      .map((g) => String(g.Name));
  }, [groupRows, groupType]);

  useEffect(() => {
    if (!groupType && groupTypes.length > 0) setGroupType(groupTypes[0]);
  }, [groupType, groupTypes]);

  useEffect(() => {
    setTabParams({});
  }, [tab]);

  const handleParamsChange = useCallback((params: Record<string, string>) => {
    setTabParams((prev) => {
      const keys = Object.keys(params);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => prev[k] === params[k])
      ) {
        return prev;
      }
      return params;
    });
  }, []);

  const queryParams = useMemo(
    () => ({
      ...buildBaseQueryParams(setup),
      ...tabParams,
    }),
    [setup, tabParams],
  );

  const analyticsEnabled = useMemo(() => {
    if (tab === "elasticity") {
      const mode = tabParams.level ?? "sku";
      if (mode === "sku" || mode === "company_sku") {
        return Boolean(tabParams.product_name || tabParams.attribute_name);
      }
      return Boolean(tabParams.attribute_name);
    }
    return true;
  }, [tab, tabParams]);

  const { data, isPending, error } = useAnalytics(studySlug, tab, queryParams, {
    enabled: Boolean(studySlug && tab && analyticsEnabled),
  });
  const isLoading = isPending && !data;
  const activeTab = getAnalyticsTab(tab);
  const ActiveController = activeTab.Controller;

  const exportRows = useMemo(
    () => activeTab.getExportRows(data?.data),
    [activeTab, data?.data],
  );

  const analyticsContext: AnalyticsContext = useMemo(
    () => ({
      productNames,
      groupTypes,
      groupMembers,
      groupType,
      setGroupType,
      scenarios,
    }),
    [productNames, groupTypes, groupMembers, groupType, scenarios],
  );

  if (!studySlug) {
    return (
      <div className="page-card">
        <h1>Chart Analysis</h1>
        <p>Load a study from Home or Simulator first.</p>
      </div>
    );
  }

  return (
    <div className="page-card analytics-page">
      <div className="page-header">
        <h1>Chart Analysis</h1>
        <div className="analytics-controls">
          <label>
            Base scenario
            <select value={baseScenario} onChange={(e) => setBaseScenario(e.target.value)}>
              <option value="">Study base</option>
              {scenarios.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => downloadCsv(`${tab}-${studySlug}.csv`, exportRows)}
            disabled={exportRows.length === 0}
          >
            Export CSV
          </button>
        </div>
      </div>

      <p className="analytics-instruction">
        Customize chart settings for each tab, then export results or review the preview chart.
      </p>

      <div className="analytics-tabs">
        {ANALYTICS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`analytics-tab${tab === t.id ? " active" : ""}`}
            onClick={() => {
              setTabParams({});
              setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ActiveController
        context={analyticsContext}
        setup={setup}
        data={data?.data}
        isLoading={isLoading}
        error={error as Error | null}
        onParamsChange={handleParamsChange}
      />
    </div>
  );
}
