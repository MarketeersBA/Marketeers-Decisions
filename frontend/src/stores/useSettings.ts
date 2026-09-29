import { useEffect, useState } from "react";

import {
  type AppSettings,
  loadSettings,
  subscribeSettings,
} from "../stores/settingsStore";

/** Live app settings (localStorage + Settings page updates). */
export function useSettings(): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  useEffect(() => {
    const unsub = subscribeSettings(setSettings);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "market-simulator-settings") setSettings(loadSettings());
    };
    const onCustom = () => setSettings(loadSettings());
    window.addEventListener("storage", onStorage);
    window.addEventListener("ms-settings-changed", onCustom);
    return () => {
      unsub();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ms-settings-changed", onCustom);
    };
  }, []);

  return settings;
}
