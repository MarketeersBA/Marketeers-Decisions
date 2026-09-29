import { useEffect, useState } from "react";

import type { FairShareRow } from "../../../api/analytics_types";
import { AnalyticsField } from "../AnalyticsField";
import { AnalyticsSection } from "../AnalyticsSection";
import { AnalyticsTabLayout } from "../AnalyticsTabLayout";
import { FairShareChart } from "../charts";
import type { AnalyticsControllerProps } from "../types";
import { fmtNum, getFairShareExportRows } from "../utils";

export function FairShareController({
  context,
  data,
  isLoading,
  error,
  onParamsChange,
}: AnalyticsControllerProps) {
  const [level, setLevel] = useState<"sku" | "group">("sku");
  const [memberChange, setMemberChange] = useState("");
  const { productNames, groupTypes, groupMembers, groupType, setGroupType } = context;

  const options = level === "sku" ? productNames : groupMembers;

  useEffect(() => {
    if (options.length > 0 && !options.includes(memberChange)) {
      setMemberChange(options[0]);
    }
  }, [options, memberChange]);

  useEffect(() => {
    if (!memberChange) return;
    const p: Record<string, string> = {
      level,
      member_change: memberChange,
      group_type: groupType,
    };
    onParamsChange(p);
  }, [level, memberChange, groupType, onParamsChange]);

  const rows = Array.isArray(data) ? (data as FairShareRow[]) : [];

  const controls = (
    <AnalyticsSection title="Fair Share Global Configuration">
      <AnalyticsField label="Level">
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
            Group (brands)
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
      <AnalyticsField label={level === "sku" ? "Member change SKU" : "Change member"}>
        <select value={memberChange} onChange={(e) => setMemberChange(e.target.value)}>
          {options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </AnalyticsField>
    </AnalyticsSection>
  );

  const output =
    rows.length > 0 ? (
      <>
        <FairShareChart data={rows} />
        <table className="data-table">
          <thead>
            <tr>
              <th>{level === "sku" ? "SKU" : "Group"}</th>
              <th>Rebased Current</th>
              <th>New Share</th>
              <th>Actual Share</th>
              <th>Fair Share</th>
              <th>Index</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{fmtNum(r.rebasedCurrentShare)}</td>
                <td>{fmtNum(r.newShare)}</td>
                <td>{fmtNum(r.actualShare)}</td>
                <td>{fmtNum(r.fairShare)}</td>
                <td>{r.index == null ? "—" : fmtNum(r.index)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ) : (
      <p className="analytics-empty">No fair share data.</p>
    );

  return (
    <AnalyticsTabLayout
      title="Fair Share"
      controls={controls}
      output={output}
      isLoading={isLoading}
      error={error}
    />
  );
}

export { getFairShareExportRows };
