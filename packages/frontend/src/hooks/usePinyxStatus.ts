import { useState, useEffect, useCallback } from "react";
import { getPinyxStatus } from "../api";
import type { PinyxStatusResponse } from "../api";

export interface PinyxStatusState {
  configured: boolean;
  endpoint: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePinyxStatus(): PinyxStatusState {
  const [state, setState] = useState<Omit<PinyxStatusState, "refresh">>({
    configured: false,
    endpoint: null,
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const status: PinyxStatusResponse = await getPinyxStatus();
      setState({ configured: status.configured, endpoint: status.endpoint, loading: false, error: null });
    } catch (err) {
      // Don't clobber `configured` on a transient failure — surface a separate error.
      setState((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "Failed to check PiNyx status" }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
