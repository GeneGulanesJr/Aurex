import { useState, useEffect, useCallback } from "react";
import { getQuotaStatus, prefireQuota, resetQuota, updateQuotaConfig } from "../api";
import type { QuotaStatusResponse, PrefireRequest, QuotaConfigUpdateRequest, WsClientEvent } from "@aurex/shared";

const POLL_INTERVAL = 30_000;

export interface QuotaState {
  status: QuotaStatusResponse | null;
  loading: boolean;
  error: string | null;
  prefire: (opts?: PrefireRequest & { providerId?: string }) => Promise<void>;
  reset: (providerId?: string) => Promise<void>;
  updateConfig: (update: QuotaConfigUpdateRequest) => Promise<void>;
  refresh: () => void;
}

interface UseQuotaDeps {
  /** Registers a handler that receives events from the shared WebSocket stream. */
  onWsEvent: (handler: (event: WsClientEvent) => void) => void;
}

export function useQuota({ onWsEvent }: UseQuotaDeps): QuotaState {
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getQuotaStatus()
      .then((s) => { setQuotaStatus(s); setLoading(false); setError(null); })
      .catch((err) => { setLoading(false); setError(err instanceof Error ? err.message : "Failed to load quota status"); });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  // Subscribe to the shared WebSocket stream so the quota UI reflects
  // quota_update / quota_exhausted events in real time instead of waiting up
  // to POLL_INTERVAL. Previously this hook opened its own (never-supplied)
  // WebSocket; it now rides the single shared connection owned by useWebSocket.
  useEffect(() => {
    onWsEvent((event: WsClientEvent) => {
      if (event.type === "quota_update" || event.type === "quota_exhausted") {
        refresh();
      }
    });
  }, [onWsEvent, refresh]);

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

  return { status: quotaStatus, loading, error, prefire, reset, updateConfig: updateConfigFn, refresh };
}
