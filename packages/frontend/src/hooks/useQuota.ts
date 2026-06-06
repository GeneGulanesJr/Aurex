import { useState, useEffect, useCallback, useRef } from "react";
import { getQuotaStatus, prefireQuota, resetQuota, updateQuotaConfig } from "../api";
import type { QuotaStatusResponse, PrefireRequest, QuotaConfigUpdateRequest } from "@aurex/shared";

const POLL_INTERVAL = 30_000;

export interface QuotaState {
  status: QuotaStatusResponse | null;
  loading: boolean;
  prefire: (opts?: PrefireRequest & { providerId?: string }) => Promise<void>;
  reset: (providerId?: string) => Promise<void>;
  updateConfig: (update: QuotaConfigUpdateRequest) => Promise<void>;
  refresh: () => void;
}

export function useQuota(wsUrl?: string): QuotaState {
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(() => {
    getQuotaStatus()
      .then((s) => { setQuotaStatus(s); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL);

    if (wsUrl) {
      try {
        const ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event?.type === "quota_update" || msg.event?.type === "quota_exhausted") {
              refresh();
            }
          } catch { /* ignore non-JSON messages */ }
        };
        ws.onerror = () => { /* ws connection failed, polling continues */ };
        wsRef.current = ws;

        return () => {
          if (intervalRef.current) clearInterval(intervalRef.current);
          ws.close();
          wsRef.current = null;
        };
      } catch { /* WebSocket construction failed, polling continues */ }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh, wsUrl]);

  const prefire = useCallback(async (opts?: PrefireRequest & { providerId?: string }) => {
    await prefireQuota(opts);
    refresh();
  }, [refresh]);

  const reset = useCallback(async (providerId?: string) => {
    await resetQuota(providerId);
    refresh();
  }, [refresh]);

  const updateConfigFn = useCallback(async (update: QuotaConfigUpdateRequest) => {
    await updateQuotaConfig(update);
    refresh();
  }, [refresh]);

  return { status: quotaStatus, loading, prefire, reset, updateConfig: updateConfigFn, refresh };
}
