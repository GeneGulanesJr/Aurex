import { useState, useCallback, useEffect } from "react";

export interface AurexSettings {
  /** Auto-collapse code context panel when mission starts */
  autoCollapseContext: boolean;
  /** Max events shown in the live event stream */
  eventStreamCount: number;
  /** Default sidebar state on desktop */
  defaultSidebarCollapsed: boolean;
  /** Browser notifications enabled */
  notificationsEnabled: boolean;
}

const STORAGE_KEY = "aurex-settings";

export const DEFAULT_SETTINGS: AurexSettings = {
  autoCollapseContext: false,
  eventStreamCount: 8,
  defaultSidebarCollapsed: false,
  notificationsEnabled: true,
};

function loadSettings(): AurexSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: AurexSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AurexSettings>(loadSettings);

  const setSettings = useCallback((next: Partial<AurexSettings>) => {
    setSettingsState((prev) => {
      const merged = { ...prev, ...next };
      saveSettings(merged);
      return merged;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, setSettings, resetSettings } as const;
}
