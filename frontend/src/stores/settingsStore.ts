const STORAGE_KEY = "market-simulator-settings";

import type { ShareColorThresholdMode } from "../lib/shareColor";

export interface AppSettings {
  decimalPlaces: number;
  shareColorThreshold: number;
  shareColorThresholdMode: ShareColorThresholdMode;
  /** Persisted ResultsGrid column ids; empty = default layout. */
  gridColumnOrder: string[];
  showRevenue: boolean;
  showPreferenceShare: boolean;
  showPenetration: boolean;
  showVolumeShare: boolean;
  showValueShare: boolean;
  showAuditShare: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  decimalPlaces: 2,
  shareColorThreshold: 3.5,
  shareColorThresholdMode: "fixed",
  gridColumnOrder: [],
  showRevenue: false,
  showPreferenceShare: true,
  showPenetration: true,
  showVolumeShare: true,
  showValueShare: false,
  showAuditShare: true,
};

type Listener = (settings: AppSettings) => void;
const listeners = new Set<Listener>();

function notify(settings: AppSettings) {
  for (const fn of listeners) fn(settings);
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  notify(settings);
  window.dispatchEvent(new CustomEvent("ms-settings-changed", { detail: settings }));
}

/** Subscribe to settings changes (Save from Settings page or same-tab updates). */
export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Columns to hide on the results grid from metric visibility flags. */
export function hiddenMetricColumns(settings: AppSettings): Set<string> {
  const hidden = new Set<string>();
  if (!settings.showVolumeShare) {
    hidden.add("N.Share");
    hidden.add("B.Share");
    hidden.add("S.Index");
  }
  if (!settings.showValueShare) {
    hidden.add("Value Share");
    hidden.add("VSU");
  }
  if (!settings.showRevenue) {
    hidden.add("Revenue");
  }
  if (!settings.showPreferenceShare) hidden.add("Preference Share");
  if (!settings.showPenetration) hidden.add("Penetration");
  if (!settings.showAuditShare) hidden.add("Audit Share");
  return hidden;
}
