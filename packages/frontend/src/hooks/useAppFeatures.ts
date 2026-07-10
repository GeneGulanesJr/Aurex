import { useEffect, useState } from "react";
import { getHealth } from "../api";

export interface AppFeatures {
  missionsEnabled: boolean;
  loaded: boolean;
}

export function useAppFeatures(): AppFeatures {
  // Scanner-only unless the frontend build explicitly opts into legacy missions.
  const missionsEnabled = import.meta.env.VITE_MISSIONS_ENABLED === "true";
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then(() => {
        if (!cancelled) setLoaded(true);
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
