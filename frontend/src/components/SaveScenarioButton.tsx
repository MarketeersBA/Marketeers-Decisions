import { useState } from "react";

import { useSaveScenario } from "../api/hooks";
import { useSession } from "../stores/sessionStore";

interface Props {
  className?: string;
  buttonClassName?: string;
  label?: string;
  disabled?: boolean;
  onToast?: (msg: string, type?: "warn" | "success") => void;
}

export function SaveScenarioButton({
  className,
  buttonClassName = "btn-secondary",
  label = "Save scenario",
  disabled = false,
  onToast,
}: Props) {
  const { session } = useSession();
  const slug = session?.slug;
  const saveScenario = useSaveScenario(slug);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!session) return null;

  const busy = saveScenario.isPending;
  const dialogTitle = "Save scenario";

  const openDialog = () => {
    setName(session.scenarioName || "");
    setDescription("");
    setOpen(true);
  };

  const runSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveScenario.mutate(
      {
        session_id: session.sessionId,
        name: trimmed,
        description,
        validation: false,
      },
      {
        onSuccess: () => {
          onToast?.(`Saved: ${trimmed}`, "success");
          setOpen(false);
          setName("");
          setDescription("");
        },
        onError: (err) => onToast?.(err.message || "Failed to save scenario", "warn"),
      },
    );
  };

  return (
    <>
      <button
        type="button"
        className={[buttonClassName, className].filter(Boolean).join(" ")}
        disabled={disabled || busy}
        onClick={openDialog}
      >
        {busy ? "Saving…" : label}
      </button>

      <div
        className={`dialog-overlay ${open ? "open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="dialog-content">
          <div className="dialog-header">
            <h3>{dialogTitle}</h3>
            <span className="gp-close" onClick={() => setOpen(false)}>
              ×
            </span>
          </div>

          <div className="dialog-body">
            <div className="form-group">
              <label>Scenario name</label>
              <input
                type="text"
                placeholder="e.g. Price +5%"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Description (optional)</label>
              <textarea
                rows={2}
                placeholder="What changed in this scenario?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="dialog-footer">
            <button className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={!name.trim() || busy}
              onClick={runSave}
            >
              {busy ? "Saving…" : "Save scenario"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
