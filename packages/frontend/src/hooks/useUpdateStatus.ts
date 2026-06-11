import { useState, useEffect, useCallback, useRef } from "react";
import type { WsClientEvent, UpdateStatusResponse } from "@aurex/shared";
import { getUpdateStatus, checkForUpdates, applyUpdate } from "../api";

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
  checkNow: () => Promise<void>;
  apply: () => Promise<void>;
}

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getUpdateStatus().then(setStatus).catch(() => {});
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
      const result = await checkForUpdates();
      setStatus(result);
    } catch {}
  }, []);

  const apply = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    try {
      await applyUpdate();
      setStatus((prev) => ({ ...prev, updateAvailable: false }));
      pollRef.current = setInterval(() => {
        fetch("/health", { cache: "no-store" })
          .then((r) => r.json())
          .then((data) => {
            if (data.status === "ok" || data.status === "degraded") {
              if (pollRef.current) clearInterval(pollRef.current);
              setApplying(false);
            }
          })
          .catch(() => {});
      }, 2000);
    } catch {
      setApplying(false);
    }
  }, [applying]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return {
    ...status,
    applying,
    checkNow,
    apply,
  };
}
