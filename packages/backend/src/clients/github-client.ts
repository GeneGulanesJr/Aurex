// packages/backend/src/clients/github-client.ts

const GITHUB_API = "https://api.github.com";

const headers = (token?: string): Record<string, string> => {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Aurex",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export async function getUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub getUser failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    login: data.login as string,
    avatar_url: data.avatar_url as string,
    name: (data.name as string | null) ?? null,
  };
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const res = await fetch(
    `${GITHUB_API}/user/repos?sort=updated&per_page=100`,
    { headers: headers(token) },
  );
  if (!res.ok) throw new Error(`GitHub listRepos failed: ${res.status}`);
  const data = await res.json() as Array<Record<string, unknown>>;
  return data.map((r) => ({
    id: r.id as number,
    full_name: r.full_name as string,
    clone_url: r.clone_url as string,
    private: r.private as boolean,
    default_branch: r.default_branch as string,
    updated_at: r.updated_at as string,
  }));
}
