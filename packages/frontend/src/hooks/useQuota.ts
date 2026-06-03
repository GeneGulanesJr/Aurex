import { useState, useEffect, useCallback, useRef } from "react";
import { getQuotaStatus, prefireQuota, resetQuota } from "../api";
import type { QuotaStatusResponse, PrefireRequest } from "@aurex/shared";

const POLL_INTERVAL = 30_000;

export interface QuotaState {
  status: QuotaStatusResponse | null;
  loading: boolean;
  prefire: (opts?: PrefireRequest) => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => void;
}

export function useQuota(): QuotaState {
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const refresh = useCallback(() => {
    getQuotaStatus()
      .then((s) => { setQuotaStatus(s); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  const prefire = useCallback(async (opts?: PrefireRequest) => {
    await prefireQuota(opts);
    refresh();
  }, [refresh]);

  const reset = useCallback(async () => {
    const s = await resetQuota();
    setQuotaStatus(s);
  }, []);

  return { status: quotaStatus, loading, prefire, reset, refresh };
}
