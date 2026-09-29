import { useEffect, useMemo, useState } from "react";

import type { ElasticityRow } from "../../../api/analytics_types";
import { AnalyticsField } from "../AnalyticsField";
import { AnalyticsSection } from "../AnalyticsSection";
import { AnalyticsTabLayout } from "../AnalyticsTabLayout";
import { ElasticityChart } from "../charts";
import type { AnalyticsControllerProps } from "../types";
import { fmtPct } from "../utils";

type ElasticityMode = "sku" | "group" | "company_sku" | "company_group";

export function ElasticityController({
  context,
  data,
  isLoading,
  error,
  onParamsChange,
}: AnalyticsControllerProps) {
  const [attributeName, setAttributeName] = useState("Price");
  const [mode, setMode] = useState<ElasticityMode>("sku");
  const [selectedSeries, setSelectedSeries] = useState("");

  const { productNames, groupTypes, groupMembers, groupType, setGroupType } = context;

  const seriesOptions = useMemo(() => {
    if (mode === "sku" || mode === "company_sku") return productNames;
    return groupMembers;
  }, [mode, productNames, groupMembers]);

  useEffect(() => {
    if (seriesOptions.length === 0) {
      setSelectedSeries("");
      return;
    }
    if (!seriesOptions.includes(selectedSeries)) {
      setSelectedSeries(seriesOptions[0]);
    }
  }, [seriesOptions, selectedSeries]);

  useEffect(() => {
    const p: Record<string, string> = {
      attribute_name: attributeName,
      level: mode,
      group_type: groupType,
    };
    if ((mode === "sku" || mode === "company_sku") && selectedSeries) {
      p.product_name = selectedSeries;
    }
    onParamsChange(p);
  }, [attributeName, mode, groupType, selectedSeries, onParamsChange]);

  const rows = Array.isArray(data) ? (data as ElasticityRow[]) : [];
  const chartKey = selectedSeries || rows[0]?.name || "";

  const controls = (
    <>
      <AnalyticsSection title="Elasticity Global Configuration">
        <AnalyticsField label="Attribute Name">
          <input
            value={attributeName}
            onChange={(e) => setAttributeName(e.target.value)}
            placeholder="Price"
          />
        </AnalyticsField>
        <AnalyticsField label="Mode">
          <div className="analytics-radio-row">
            {(
              [
                ["sku", "Per SKU"],
                ["group", "Per Group"],
                ["company_sku", "Per Company (SKU)"],
                ["company_group", "Per Company (Group)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="analytics-checkbox">
                <input
                  type="radio"
                  name="elasticity-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </AnalyticsField>
        {(mode === "group" || mode === "company_group") && (
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
        <p className="analytics-hint">
          Relative share change (Δshare / base), not textbook price elasticity.
        </p>
      </AnalyticsSection>
      <AnalyticsSection title="Chart Output Series">
        <AnalyticsField label={mode.includes("group") ? "Group member" : "SKU"}>
          <select value={selectedSeries} onChange={(e) => setSelectedSeries(e.target.value)}>
            {seriesOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </AnalyticsField>
      </AnalyticsSection>
    </>
  );

  const output =
    rows.length > 0 ? (
      <>
        <ElasticityChart data={rows} sku={chartKey} />
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Levels (relative share change)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>
                  {Object.entries(r.levels)
                    .map(([k, v]) => `${k}: ${fmtPct(v)}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ) : (
      <p className="analytics-empty">No elasticity data for the selected settings.</p>
    );

  return (
    <AnalyticsTabLayout
      title="Elasticity"
      controls={controls}
      output={output}
      isLoading={isLoading}
      error={error}
    />
  );
}
