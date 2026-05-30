import { useState, useEffect, useCallback } from "react";
import {
  getGitHubStatus,
  getGitHubConfig,
  saveGitHubConfig,
  getGitHubConnectUrl,
  getGitHubRepos,
  disconnectGitHub,
} from "../api";
import type { GitHubStatusResponse, GitHubRepoResponse, GitHubConfigResponse, SaveGitHubConfigRequest } from "../api";

export interface GitHubState {
  configured: boolean;
  connected: boolean;
  user: GitHubStatusResponse["user"];
  repos: GitHubRepoResponse[];
  config: GitHubConfigResponse | null;
  loading: boolean;
  error: string | null;
}

export interface UseGitHubReturn extends GitHubState {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  saveConfig: (config: SaveGitHubConfigRequest) => Promise<void>;
  refreshRepos: () => Promise<void>;
}

export function useGitHub(): UseGitHubReturn {
  const [state, setState] = useState<GitHubState>({
    configured: false,
    connected: false,
    user: null,
    repos: [],
    config: null,
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
        configured: status.configured,
        connected: status.connected,
        user: status.user,
        config,
        loading: false,
        error: null,
      }));
      if (status.connected) {
        await refreshRepos();
      }
    } catch {
      setState((prev) => ({
        ...prev,
        configured: false,
        connected: false,
        loading: false,
        error: "Failed to check GitHub status",
      }));
    }
  }, [refreshRepos]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubError = params.get("github_error");
    if (!githubError) return;

    const messages: Record<string, string> = {
      expired: "GitHub connection expired. Please try again.",
      exchange_failed: "GitHub authorization failed. Please try again.",
      user_fetch_failed: "Failed to fetch GitHub profile. Please try again.",
      missing_params: "Invalid GitHub callback. Please try again.",
    };
    setState((prev) => ({
      ...prev,
      error: messages[githubError] ?? "GitHub connection error.",
      loading: false,
    }));
    window.history.replaceState({}, "", "/");
  }, []);

  const connect = useCallback(async () => {
    try {
      const { url } = await getGitHubConnectUrl();
      window.location.assign(url);
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to initiate GitHub connect" }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      setState({
        configured: true,
        connected: false,
        user: null,
        repos: [],
        config: null,
        loading: false,
        error: null,
      });
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to disconnect GitHub" }));
    }
  }, []);

  const saveConfig = useCallback(async (config: SaveGitHubConfigRequest) => {
    try {
      const saved = await saveGitHubConfig(config);
      setState((prev) => ({
        ...prev,
        configured: saved.configured,
        config: saved,
        loading: false,
        error: null,
      }));
      await refreshStatus();
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to save GitHub settings" }));
    }
  }, [refreshStatus]);

  return { ...state, connect, disconnect, saveConfig, refreshRepos };
}
