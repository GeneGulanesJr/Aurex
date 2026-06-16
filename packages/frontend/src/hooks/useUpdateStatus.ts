import { useState, useEffect, useCallback, useRef } from "react";
import type { WsClientEvent, UpdateStatusResponse } from "@aurex/shared";
import { getUpdateStatus, checkForUpdates, applyUpdate, getHealth } from "../api";

interface UseUpdateStatusDeps {
  onWsEvent: (handler: (event: WsClientEvent) => void) => void;
}

export interface UpdateStatus {
  updateAvailable: boolean;
  currentSha: string;
  latestSha: string;
  behindBy: number;
  lastChecked: string | null;
  applying: boolean;
  error: string | null;
  checkNow: () => Promise<void>;
  apply: () => Promise<void>;
}

const APPLY_MAX_POLLS = 30;

export function useUpdateStatus(deps: UseUpdateStatusDeps): UpdateStatus {
  const { onWsEvent } = deps;

  const [status, setStatus] = useState<UpdateStatusResponse>({
    updateAvailable: false,
    currentSha: "",
    latestSha: "",
    behindBy: 0,
    lastChecked: null,
  });
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  useEffect(() => {
    getUpdateStatus().then(setStatus).catch(() => setError("Failed to check for updates"));
  }, []);

  useEffect(() => {
    onWsEvent((event: WsClientEvent) => {
      if (event.type === "update_available") {
        setStatus({
          updateAvailable: true,
          currentSha: event.currentSha,
          latestSha: event.latestSha,
          behindBy: event.behindBy,
          lastChecked: new Date().toISOString(),
        });
      }
    });
  }, [onWsEvent]);

  const checkNow = useCallback(async () => {
    try {
      setError(null);
      const result = await checkForUpdates();
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manual update check failed");
    }
  }, []);

  const apply = useCallback(async () => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setError(null);
    pollCountRef.current = 0;
    try {
      await applyUpdate();
      setStatus((prev) => ({ ...prev, updateAvailable: false }));
      pollRef.current = setInterval(() => {
        pollCountRef.current += 1;
        if (pollCountRef.current >= APPLY_MAX_POLLS) {
          if (pollRef.current) clearInterval(pollRef.current);
          applyingRef.current = false;
          setApplying(false);
          setError("Update may not have completed — server did not return healthy within the timeout.");
          return;
        }
        getHealth()
          .then((data) => {
            if (data.status === "ok" || data.status === "degraded") {
              if (pollRef.current) clearInterval(pollRef.current);
              applyingRef.current = false;
              setApplying(false);
            }
          })
          .catch(() => {});
      }, 2000);
    } catch (err) {
      applyingRef.current = false;
      setApplying(false);
      setError(err instanceof Error ? err.message : "Failed to apply update");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return {
    ...status,
    applying,
    error,
    checkNow,
    apply,
  };
}
