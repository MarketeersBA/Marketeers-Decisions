import { useEffect, useRef, useState } from "react";

import { AppSelect } from "./AppSelect";
import { DEFAULT_CURRENCY_SYMBOL } from "../lib/studyDisplay";
import { type AppSettings, loadSettings, saveSettings } from "../stores/settingsStore";
import { useSession } from "../stores/sessionStore";
import "./settings-popover.css";

const METRIC_TOGGLE_KEYS = [
  ["showVolumeShare", "Volume share"],
  ["showValueShare", "Value share"],
  ["showRevenue", "Revenue"],
  ["showPreferenceShare", "Preference share"],
  ["showPenetration", "Penetration"],
  ["showAuditShare", "Audit share"],
] as const;

/** Compact settings control for the results-grid toolbar. */
export function SettingsPopover() {
  const { session } = useSession();
  const currency =
    session?.study?.currencySymbol?.trim() || DEFAULT_CURRENCY_SYMBOL;
  const metricToggles = METRIC_TOGGLE_KEYS.map(([key, base]) => {
    if (key === "showValueShare" || key === "showRevenue") {
      return [key, `${base} (${currency})`] as const;
    }
    return [key, base] as const;
  });
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSettings(loadSettings());
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((s) => {
      const next = { ...s, [key]: value };
      saveSettings(next);
      return next;
    });
  };

  return (
    <div className="settings-popover-root" ref={rootRef}>
      <button
        type="button"
        className={`settings-gear-btn${open ? " open" : ""}`}
        aria-label="Settings"
        aria-expanded={open}
        title="Settings"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>
      {open ? (
        <div className="settings-popover" role="dialog" aria-label="Display settings">
          <div className="settings-popover-head">
            <strong>Settings</strong>
            <button type="button" className="settings-popover-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <p className="settings-popover-sub">
            Display and metric visibility (this browser). Changes apply live.
          </p>

          <section className="settings-section">
            <h3>Display</h3>
            <label className="settings-row">
              Decimal places
              <input
                type="number"
                min={0}
                max={4}
                value={settings.decimalPlaces}
                onChange={(e) => update("decimalPlaces", parseInt(e.target.value, 10) || 0)}
              />
            </label>
            <label className="settings-row">
              Share color threshold
              <AppSelect
                className="settings-app-select"
                ariaLabel="Share color threshold"
                value={settings.shareColorThresholdMode}
                onChange={(value) =>
                  update("shareColorThresholdMode", value as AppSettings["shareColorThresholdMode"])
                }
                items={[
                  { value: "fixed", label: "Fixed % vs B.Share" },
                  { value: "sigma1", label: "1σ of change rates" },
                ]}
              />
            </label>
            {settings.shareColorThresholdMode === "fixed" ? (
              <label className="settings-row">
                Threshold (%)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={settings.shareColorThreshold}
                  onChange={(e) => update("shareColorThreshold", parseFloat(e.target.value) || 3.5)}
                />
              </label>
            ) : (
              <p className="settings-popover-hint">
                Highlights cells when a row&apos;s relative share change exceeds one standard deviation of
                all SKU changes in the grid. Falls back to the fixed threshold when σ cannot be computed.
              </p>
            )}
            {settings.shareColorThresholdMode === "sigma1" ? (
              <label className="settings-row">
                Fallback threshold (%)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={settings.shareColorThreshold}
                  onChange={(e) => update("shareColorThreshold", parseFloat(e.target.value) || 3.5)}
                />
              </label>
            ) : null}
            {settings.gridColumnOrder.length > 0 ? (
              <button
                type="button"
                className="settings-reset-btn"
                onClick={() => update("gridColumnOrder", [])}
              >
                Reset column order
              </button>
            ) : null}
          </section>

          <section className="settings-section">
            <h3>Metrics visibility</h3>
            {metricToggles.map(([key, label]) => (
              <label key={key} className="settings-check">
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) => update(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </section>
        </div>
      ) : null}
    </div>
  );
}
