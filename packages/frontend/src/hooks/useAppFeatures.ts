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
        setMissionsEnabled(health.features?.missionsEnabled ?? false);
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
