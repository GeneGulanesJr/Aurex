import { useState, useEffect, useCallback } from "react";
import { getPinyxStatus } from "../api";
import type { PinyxStatusResponse } from "../api";

export interface PinyxStatusState {
  configured: boolean;
  endpoint: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function usePinyxStatus(): PinyxStatusState {
  const [state, setState] = useState<Omit<PinyxStatusState, "refresh">>({
    configured: false,
    endpoint: null,
    loading: true,
  });

  const refresh = useCallback(async () => {
    try {
      const status: PinyxStatusResponse = await getPinyxStatus();
      setState({ configured: status.configured, endpoint: status.endpoint, loading: false });
    } catch {
      setState({ configured: false, endpoint: null, loading: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
