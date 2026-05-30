import { useState, useEffect, useCallback } from "react";
import {
  getGitHubStatus,
  connectGitHub,
  getGitHubRepos,
  disconnectGitHub,
} from "../api";
import type { GitHubStatusResponse, GitHubRepoResponse } from "../api";

export interface GitHubState {
  connected: boolean;
  user: GitHubStatusResponse["user"];
  repos: GitHubRepoResponse[];
  loading: boolean;
  error: string | null;
}

export interface UseGitHubReturn extends GitHubState {
  connect: (token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshRepos: () => Promise<void>;
}

export function useGitHub(): UseGitHubReturn {
  const [state, setState] = useState<GitHubState>({
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
      const status = await getGitHubStatus();
      setState((prev) => ({
        ...prev,
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

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connect = useCallback(async (token: string) => {
    try {
      const result = await connectGitHub(token);
      setState((prev) => ({
        ...prev,
        connected: result.connected,
        user: result.user,
        error: null,
      }));
      await refreshRepos();
    } catch {
      setState((prev) => ({ ...prev, error: "Invalid GitHub token" }));
    }
  }, [refreshRepos]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      setState({
        connected: false,
        user: null,
        repos: [],
        loading: false,
        error: null,
      });
    } catch {
      setState((prev) => ({ ...prev, error: "Failed to disconnect GitHub" }));
    }
  }, []);

  return { ...state, connect, disconnect, refreshRepos };
}
