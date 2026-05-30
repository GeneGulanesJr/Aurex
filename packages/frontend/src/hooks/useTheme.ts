import { useState, useCallback, useEffect } from "react";

export type ThemeId = "solar-flare" | "frost-command" | "signal-red";
export const VALID_THEMES: ThemeId[] = ["solar-flare", "frost-command", "signal-red"];

export function resolveTheme(raw: string | null): ThemeId {
  if (raw && (VALID_THEMES as string[]).includes(raw)) return raw as ThemeId;
  return "solar-flare";
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("aurex-theme") : null;
    return resolveTheme(stored);
  });

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    localStorage.setItem("aurex-theme", next);
  }, []);

  return { theme, setTheme, themes: VALID_THEMES } as const;
}
