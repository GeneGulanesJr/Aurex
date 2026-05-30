import { useState, useEffect, useCallback } from "react";
import {
  getGitHubStatus,
  getGitHubConfig,
  getGitHubConnectUrl,
  getGitHubRepos,
  disconnectGitHub,
} from "../api";
import type { GitHubStatusResponse, GitHubRepoResponse, GitHubConfigResponse } from "../api";

export interface GitHubState {
  config: GitHubConfigResponse | null;
  connected: boolean;
  user: GitHubStatusResponse["user"];
  repos: GitHubRepoResponse[];
  loading: boolean;
  error: string | null;
}

export interface UseGitHubReturn extends GitHubState {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshRepos: () => Promise<void>;
}

export function useGitHub(): UseGitHubReturn {
  const [state, setState] = useState<GitHubState>({
    config: null,
    connected: false,
    user: null,
    repos: [],
    loading: true,
    error: null,
  });

  const refreshRepos = useCallback(async () => {
    try {
      const repos = await getGitHubRepos();
      setState((prev) => ({ ...prev, repos }));
    } catch {
      setState((prev) => ({ ...prev, repos: [] }));
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const [status, config] = await Promise.all([
        getGitHubStatus(),
        getGitHubConfig(),
      ]);
      setState((prev) => ({
        ...prev,
        config,
        connected: status.connected,
        user: status.user,
        loading: false,
        error: null,
      }));
      if (status.connected) {
        await refreshRepos();
      }
    } catch {
      setState((prev) => ({
        ...prev,
        connected: false,
        loading: false,
        error: "Failed to check GitHub status",
      }));
    }
  }, [refreshRepos]);

  // Initial load + URL param handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubParam = params.get("github");

    if (githubParam) {
      // Clean URL params
      const url = new URL(window.location.href);
      url.searchParams.delete("github");
      url.searchParams.delete("message");
      window.history.replaceState({}, "", url.toString());

      if (githubParam === "error") {
        const message = params.get("message") || "OAuth failed";
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    }

    void refreshStatus();
  }, [refreshStatus]);

  const connect = useCallback(async () => {
    try {
      const { url } = await getGitHubConnectUrl();
      window.location.href = url;
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to start GitHub OAuth" }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      setState({
        config: null,
        connected: false,
        user: null,
        repos: [],
        loading: false,
        error: null,
      });
      // Reload config since we only disconnected, not de-configured
      const config = await getGitHubConfig();
      setState((prev) => ({ ...prev, config }));
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to disconnect GitHub" }));
    }
  }, []);

  return { ...state, connect, disconnect, refreshRepos };
}
