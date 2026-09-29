import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useApplyScenario,
  useDeleteScenario,
  useSaveScenario,
  useScenarios,
} from "../api/hooks";
import { useSession } from "../stores/sessionStore";
import "./runner-panels.css";

export function ScenariosPanel() {
  const { session, setSession } = useSession();
  const slug = session?.slug;
  const { data: scenarios = [] } = useScenarios(slug);
  const applyScenario = useApplyScenario();
  const saveScenario = useSaveScenario(slug);
  const deleteScenario = useDeleteScenario(slug);

  const [loadName, setLoadName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [delName, setDelName] = useState("");
  const [message, setMessage] = useState("");

  if (!session) return null;

  const names = scenarios.map((s) => s.name);

  return (
    <div className="runner-panel">
      <div className="runner-panel-title">Scenarios</div>

      {names.length > 0 ? (
        <>
          <label className="field-label">
            Load scenario
            <select value={loadName} onChange={(e) => setLoadName(e.target.value)}>
              <option value="">—</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {scenarios.find((s) => s.name === n)?.validation ? " (legacy V)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary btn-sm btn-block"
            disabled={!loadName || applyScenario.isPending}
            onClick={() =>
              applyScenario.mutate(
                { sessionId: session.sessionId, name: loadName },
                {
                  onSuccess: (payload) => {
                    setSession(payload);
                    setMessage(`Loaded: ${loadName}`);
                  },
                },
              )
            }
          >
            Apply Scenario
          </button>
        </>
      ) : (
        <p className="panel-hint">No saved scenarios yet.</p>
      )}

      <button
        type="button"
        className="btn-link"
        onClick={() => setSaveOpen((v) => !v)}
      >
        {saveOpen ? "− Save current state" : "+ Save current state"}
      </button>

      {saveOpen ? (
        <div className="save-form">
          <label className="field-label">
            Name
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="field-label">
            Description
            <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} />
          </label>
          <button
            type="button"
            className="btn-primary btn-sm btn-block"
            disabled={!newName.trim() || saveScenario.isPending}
            onClick={() =>
              saveScenario.mutate(
                {
                  session_id: session.sessionId,
                  name: newName.trim(),
                  description: newDesc,
                  validation: false,
                },
                {
                  onSuccess: () => {
                    setMessage(`Saved: ${newName.trim()}`);
                    setNewName("");
                    setNewDesc("");
                    setSaveOpen(false);
                  },
                },
              )
            }
          >
            Save Scenario
          </button>
        </div>
      ) : null}

      {names.length > 0 ? (
        <>
          <label className="field-label">
            Delete
            <select value={delName} onChange={(e) => setDelName(e.target.value)}>
              <option value="">—</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-danger btn-sm btn-block"
            disabled={!delName || deleteScenario.isPending}
            onClick={() =>
              deleteScenario.mutate(delName, {
                onSuccess: () => {
                  setMessage(`Deleted: ${delName}`);
                  setDelName("");
                },
              })
            }
          >
            Delete Scenario
          </button>
        </>
      ) : null}

        <Link className="btn-link" to={`/studies/${slug}/scenarios`} style={{ display: "block", marginTop: 8 }}>
          Manage all scenarios →
        </Link>

      {message ? <p className="panel-msg">{message}</p> : null}
      {session.scenarioName ? (
        <p className="panel-hint">Active: {session.scenarioName}</p>
      ) : null}
    </div>
  );
}
