import { useEffect, useState } from "react";
import { getHealth } from "../api";

export interface AppFeatures {
  missionsEnabled: boolean;
  loaded: boolean;
}

export function useAppFeatures(): AppFeatures {
  const [missionsEnabled, setMissionsEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((health) => {
        if (cancelled) return;
        // Scanner-only by default. Re-enable the legacy coding-agent UI only when
        // both the backend flag and VITE_MISSIONS_ENABLED=true are set.
        const backendEnabled = health.features?.missionsEnabled ?? false;
        const explicitFrontendEnable = import.meta.env.VITE_MISSIONS_ENABLED === "true";
        setMissionsEnabled(explicitFrontendEnable && backendEnabled);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { missionsEnabled, loaded };
}
