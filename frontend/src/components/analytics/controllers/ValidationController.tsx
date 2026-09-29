import { useEffect, useMemo, useState } from "react";

import type { ValidationData } from "../../../api/analytics_types";
import { AnalyticsField } from "../AnalyticsField";
import { AnalyticsSection } from "../AnalyticsSection";
import { AnalyticsTabLayout } from "../AnalyticsTabLayout";
import { ValidationChart } from "../charts";
import type { AnalyticsControllerProps } from "../types";
import { fmtPct, getValidationExportRows } from "../utils";

export function ValidationController({
  context,
  data,
  isLoading,
  error,
  onParamsChange,
}: AnalyticsControllerProps) {
  const { productNames, groupTypes, groupMembers, groupType, setGroupType, scenarios } = context;

  const validationScenarioNames = useMemo(
    () => scenarios.filter((s) => s.validation).map((s) => s.name),
    [scenarios],
  );
  const allScenarioNames = useMemo(() => scenarios.map((s) => s.name), [scenarios]);

  const [level, setLevel] = useState<"sku" | "group">("sku");
  const [layout, setLayout] = useState<"by_series" | "by_scenario">("by_scenario");
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);

  const seriesOptions = level === "sku" ? productNames : groupMembers;

  useEffect(() => {
    // Prefer validation-flagged scenarios; else leave empty → study base / page base scenario
    if (selectedScenarios.length === 0 && validationScenarioNames.length > 0) {
      setSelectedScenarios(validationScenarioNames);
    }
  }, [validationScenarioNames, selectedScenarios.length]);

  useEffect(() => {
    setSelectedSeries([]);
  }, [level, groupType]);

  useEffect(() => {
    const p: Record<string, string> = {
      level,
      layout,
      group_type: groupType,
    };
    if (selectedSeries.length > 0) p.series = selectedSeries.join(",");
    if (selectedScenarios.length > 0) p.scenarios = selectedScenarios.join(",");
    onParamsChange(p);
  }, [level, layout, groupType, selectedSeries, selectedScenarios, onParamsChange]);

  const payload = data && !Array.isArray(data) ? (data as ValidationData) : null;
  const tables = payload?.tables ?? [];

  const toggle = (list: string[], value: string, setter: (v: string[]) => void) => {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const controls = (
    <>
      <AnalyticsSection title="Validation Global Configuration">
        <p className="analytics-hint">
          After each scenario run, shares are rebased so total NewShare equals total Audit
          Share (desktop ChartForm). Values are decimal shares.
        </p>
        <AnalyticsField label="Series level">
          <div className="analytics-radio-row">
            <label>
              <input
                type="radio"
                checked={level === "sku"}
                onChange={() => setLevel("sku")}
              />{" "}
              SKU
            </label>
            <label>
              <input
                type="radio"
                checked={level === "group"}
                onChange={() => setLevel("group")}
              />{" "}
              Group
            </label>
          </div>
        </AnalyticsField>
        {level === "group" && (
          <AnalyticsField label="Group type">
            <select value={groupType} onChange={(e) => setGroupType(e.target.value)}>
              {groupTypes.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </AnalyticsField>
        )}
        <AnalyticsField label="Layout">
          <div className="analytics-radio-row">
            <label>
              <input
                type="radio"
                checked={layout === "by_scenario"}
                onChange={() => setLayout("by_scenario")}
              />{" "}
              By scenario (rows = series)
            </label>
            <label>
              <input
                type="radio"
                checked={layout === "by_series"}
                onChange={() => setLayout("by_series")}
              />{" "}
              By series (rows = scenarios)
            </label>
          </div>
        </AnalyticsField>
      </AnalyticsSection>

      <AnalyticsSection title="Series">
        <p className="analytics-hint">Leave empty to include all {level === "sku" ? "SKUs" : "groups"}.</p>
        <div className="analytics-checklist">
          {seriesOptions.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={selectedSeries.includes(name)}
                onChange={() => toggle(selectedSeries, name, setSelectedSeries)}
              />{" "}
              {name}
            </label>
          ))}
        </div>
      </AnalyticsSection>

      <AnalyticsSection title="Scenarios">
        <p className="analytics-hint">
          For held-out model checks with audit shares, use validation waves on{" "}
          <strong>Data Hub &amp; Trust</strong>. Here you can compare saved what-if scenarios
          (legacy <strong>V</strong> scenarios are read-only).
        </p>
        <div className="analytics-checklist">
          {allScenarioNames.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={selectedScenarios.includes(name)}
                onChange={() => toggle(selectedScenarios, name, setSelectedScenarios)}
              />{" "}
              {name}
              {scenarios.find((s) => s.name === name)?.validation ? " (legacy V)" : ""}
            </label>
          ))}
        </div>
      </AnalyticsSection>
    </>
  );

  const output =
    tables.length > 0 ? (
      <>
        {tables.map((table) => (
          <div key={table.title} className="analytics-validation-table">
            <h3>{table.title}</h3>
            <ValidationChart data={table.rows} />
            <table className="data-table">
              <thead>
                <tr>
                  <th>{layout === "by_series" ? "Scenario" : level === "sku" ? "SKU" : "Group"}</th>
                  <th>Audit Share</th>
                  <th>Rebased Simulator Share</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={`${table.title}-${r.label}`}>
                    <td>{r.label}</td>
                    <td>{fmtPct(r.audit)}</td>
                    <td>{fmtPct(r.rebased)}</td>
                    <td>{fmtPct(r.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </>
    ) : (
      <p className="analytics-empty">No validation data.</p>
    );

  return (
    <AnalyticsTabLayout
      title="Validation"
      controls={controls}
      output={output}
      isLoading={isLoading}
      error={error}
    />
  );
}

export { getValidationExportRows };
