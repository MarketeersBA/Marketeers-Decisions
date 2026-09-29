import { useEffect, useState } from "react";

import { useApplySegmentation } from "../api/hooks";
import type { SegmentFilter, SegmentationState } from "../api/types";
import { useSession } from "../stores/sessionStore";
import "./runner-panels.css";

interface Props {
  segmentation: SegmentationState;
}

function filterLabel(seg: SegmentationState, f: SegmentFilter): string {
  const dim = seg.dimensions.find((d) => d.assignmentKey === f.assignmentKey);
  return `${dim?.label ?? f.assignmentKey} → ${f.member}`;
}

export function SegmentationPanel({ segmentation }: Props) {
  const { session, setSession } = useSession();
  const applySeg = useApplySegmentation();

  const [pending, setPending] = useState<SegmentFilter[]>([]);
  const [dimension, setDimension] = useState("");
  const [member, setMember] = useState("");

  useEffect(() => {
    const active = segmentation.activeFilters ?? (segmentation.active ? [segmentation.active] : []);
    setPending(active);
  }, [segmentation.activeFilters, segmentation.active]);

  if (!session || segmentation.dimensions.length === 0) return null;

  const members =
    dimension && dimension !== "__all__"
      ? (segmentation.membersByKey[dimension] ?? [])
      : [];

  const onApply = () => {
    applySeg.mutate(
      {
        sessionId: session.sessionId,
        filters: pending.length > 0 ? pending.map((f) => ({
          assignment_key: f.assignmentKey,
          member: f.member,
        })) : null,
        assignment_key: null,
        member: null,
      },
      { onSuccess: setSession },
    );
  };

  const onReset = () => {
    setPending([]);
    applySeg.mutate(
      { sessionId: session.sessionId, filters: null, assignment_key: null, member: null },
      { onSuccess: setSession },
    );
  };

  const addFilter = () => {
    if (!dimension || !member) return;
    if (pending.some((f) => f.assignmentKey === dimension && f.member === member)) return;
    setPending([...pending, { assignmentKey: dimension, member }]);
    setMember("");
  };

  const removeFilter = (idx: number) => {
    setPending(pending.filter((_, i) => i !== idx));
  };

  return (
    <div className="runner-panel">
      <div className="runner-panel-title">Segmentation (AND)</div>
      {pending.length > 0 ? (
        <div className="seg-chips">
          {pending.map((f, i) => (
            <span key={`${f.assignmentKey}-${f.member}`} className="seg-chip">
              {filterLabel(segmentation, f)}
              <button type="button" className="seg-chip-x" onClick={() => removeFilter(i)} aria-label="Remove filter">
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="seg-hint">All respondents</div>
      )}
      <label className="field-label">
        Dimension
        <select
          value={dimension || "__all__"}
          onChange={(e) => {
            const v = e.target.value;
            setDimension(v === "__all__" ? "" : v);
            setMember("");
          }}
        >
          <option value="__all__">Select dimension…</option>
          {segmentation.dimensions.map((d) => (
            <option key={d.assignmentKey} value={d.assignmentKey}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      {dimension ? (
        <label className="field-label">
          Member
          <select value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="">Select member…</option>
            {members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="btn-row">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={addFilter}
          disabled={!dimension || !member}
        >
          Add filter
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={onApply}
          disabled={applySeg.isPending}
        >
          Apply
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onReset} disabled={applySeg.isPending}>
          Reset
        </button>
      </div>
      {session.study.activeSegment ? (
        <div className="segment-badge">
          Active: {session.study.activeSegment}
          {session.study.filteredRespondents != null ? (
            <span> · {session.study.filteredRespondents} respondents</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
