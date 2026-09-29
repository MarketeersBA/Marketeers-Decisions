import { useEffect, useState } from "react";

import type { AnalyticsTabId, IncrementalRow } from "../../../api/analytics_types";
import { AnalyticsField } from "../AnalyticsField";
import { AnalyticsSection } from "../AnalyticsSection";
import { AnalyticsTabLayout } from "../AnalyticsTabLayout";
import { IncrementalChart } from "../charts";
import type { AnalyticsControllerProps } from "../types";
import { fmtNum, getIncrementalExportRows } from "../utils";

interface IncrementalControllerProps extends AnalyticsControllerProps {
  mode: Extract<AnalyticsTabId, "introduction" | "removal">;
}

export function IncrementalController({
  mode,
  context,
  data,
  isLoading,
  error,
  onParamsChange,
}: IncrementalControllerProps) {
  const [groupMember, setGroupMember] = useState("");
  const [productsCsv, setProductsCsv] = useState("");
  const [metric, setMetric] = useState<"revenue" | "share">("revenue");
  const [incMode, setIncMode] = useState<"exclusive" | "cumulative">("exclusive");

  const { productNames, groupTypes, groupMembers, groupType, setGroupType } = context;
  const title = mode === "introduction" ? "Introduction" : "Removal";
  const sectionTitle =
    mode === "introduction"
      ? "Introduction Global Configuration"
      : "Removal Global Configuration";

  useEffect(() => {
    if (groupMembers.length > 0 && !groupMember) {
      setGroupMember(groupMembers[0]);
    }
  }, [groupMember, groupMembers]);

  useEffect(() => {
    const p: Record<string, string> = {
      mode: incMode,
      incremental_type: metric === "revenue" ? "Revenue" : "Market Share",
    };
    if (groupType) p.group_type = groupType;
    if (groupMember) p.group_member = groupMember;
    if (productsCsv.trim()) p.products = productsCsv.trim();
    onParamsChange(p);
  }, [groupType, groupMember, productsCsv, incMode, metric, onParamsChange]);

  const rows = Array.isArray(data) ? (data as IncrementalRow[]) : [];
  const chartMetric = metric;

  const controls = (
    <>
      <AnalyticsSection title={sectionTitle}>
        <AnalyticsField label="Mode">
          <div className="analytics-radio-row">
            <label className="analytics-checkbox">
              <input
                type="radio"
                name={`${mode}-inc-mode`}
                checked={incMode === "exclusive"}
                onChange={() => setIncMode("exclusive")}
              />
              Exclusive
            </label>
            <label className="analytics-checkbox">
              <input
                type="radio"
                name={`${mode}-inc-mode`}
                checked={incMode === "cumulative"}
                onChange={() => setIncMode("cumulative")}
              />
              Cumulative
            </label>
          </div>
        </AnalyticsField>
        <AnalyticsField label="Group type">
          <select value={groupType} onChange={(e) => setGroupType(e.target.value)}>
            {groupTypes.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </AnalyticsField>
        <AnalyticsField label="Group member">
          <select value={groupMember} onChange={(e) => setGroupMember(e.target.value)}>
            {groupMembers.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </AnalyticsField>
        <AnalyticsField label="Products" wide>
          <input
            value={productsCsv}
            onChange={(e) => setProductsCsv(e.target.value)}
            placeholder={
              productNames.slice(0, 3).join(", ") || "SKU A, SKU B"
            }
          />
        </AnalyticsField>
        <p className="analytics-hint">
          {incMode === "cumulative"
            ? "Introduces products in descending standalone share order (greedy available via intro_order API param)."
            : "Measures each product independently against the current lineup."}
        </p>
      </AnalyticsSection>
      <AnalyticsSection title="Find In Terms Of">
        <div className="analytics-radio-row">
          <label className="analytics-checkbox">
            <input
              type="radio"
              name={`${mode}-metric`}
              checked={metric === "revenue"}
              onChange={() => setMetric("revenue")}
            />
            Revenues
          </label>
          <label className="analytics-checkbox">
            <input
              type="radio"
              name={`${mode}-metric`}
              checked={metric === "share"}
              onChange={() => setMetric("share")}
            />
            Market Share
          </label>
        </div>
      </AnalyticsSection>
    </>
  );

  const output =
    rows.length > 0 ? (
      <>
        <IncrementalChart data={rows} metric={chartMetric} mode={incMode} />
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Revenue</th>
              <th>Market Share</th>
              <th>Revenue Delta</th>
              <th>Share Delta</th>
              {incMode === "cumulative" && <th>Step Delta</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productName}>
                <td>
                  {r.productName}
                  {r.error ? ` (${r.error})` : ""}
                </td>
                <td>{fmtNum(r.revenue, 4)}</td>
                <td>{fmtNum(r.marketShare, 4)}</td>
                <td>{fmtNum(r.revenueDelta, 4)}</td>
                <td>{fmtNum(r.marketShareDelta, 4)}</td>
                {incMode === "cumulative" && (
                  <td>{fmtNum(r.incrementalDelta ?? 0, 4)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ) : (
      <p className="analytics-empty">No incremental data. Add products and run again.</p>
    );

  return (
    <AnalyticsTabLayout
      title={title}
      controls={controls}
      output={output}
      isLoading={isLoading}
      error={error}
    />
  );
}

export { getIncrementalExportRows };
