import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { LaPisClient } from "../clients/lapis-client.js";

const execFileAsync = promisify(execFile);

export interface PrepareRepoResult {
  repoPath: string;
  repoStatus: "cloned" | "updated";
}

export interface PrepareRepoOptions {
  lapis: LaPisClient;
  parentRepoRoot: string;
  cloneUrl?: string;
}

export function repoDirNameFromCloneUrl(cloneUrl: string): string {
  const parsed = new URL(cloneUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error(`Invalid GitHub clone URL: ${cloneUrl}`);
  }
  const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GitHub clone URL: ${cloneUrl}`);
  }
  return `${parts[0]}-${parts[1]}`.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function normalizeGitHubCloneUrl(cloneUrl: string): string {
  const parsed = new URL(cloneUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error(`Invalid GitHub clone URL: ${cloneUrl}`);
  }
  const pathname = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
  const parts = pathname.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GitHub clone URL: ${cloneUrl}`);
  }
  return `https://github.com/${parts[0]}/${parts[1]}.git`;
}

function withToken(cloneUrl: string, token?: string): string {
  if (!token || !cloneUrl.startsWith("https://github.com/")) return cloneUrl;
  return cloneUrl.replace("https://github.com/", `https://x-access-token:${encodeURIComponent(token)}@github.com/`);
}

async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

export async function prepareRepoForMission({
  lapis,
  parentRepoRoot,
  cloneUrl,
}: PrepareRepoOptions): Promise<PrepareRepoResult> {
  if (!cloneUrl) {
    // When no cloneUrl is provided, parentRepoRoot must already be a git repo.
    // In Docker, /workspace is just a volume mount point — not a repo itself.
    if (!(await pathExists(path.join(parentRepoRoot, ".git")))) {
      throw new Error(
        `No cloneUrl provided and ${parentRepoRoot} is not a git repository. ` +
        "Provide a GitHub clone URL when creating the mission.",
      );
    }
    return { repoPath: parentRepoRoot, repoStatus: "updated" };
  }

  const normalizedCloneUrl = normalizeGitHubCloneUrl(cloneUrl);
  const reposRoot = path.join(parentRepoRoot, "repos");
  const repoPath = path.join(reposRoot, repoDirNameFromCloneUrl(normalizedCloneUrl));
  await mkdir(reposRoot, { recursive: true });

  if (await pathExists(path.join(repoPath, ".git"))) {
    await execFileAsync("git", ["fetch", "--all", "--prune"], { cwd: repoPath });
    return { repoPath, repoStatus: "updated" };
  }

  const tokenData = await lapis.getSetting<{ access_token: string }>("github_token");
  const authenticatedUrl = withToken(normalizedCloneUrl, tokenData?.access_token);
  await execFileAsync("git", ["clone", authenticatedUrl, repoPath], { cwd: reposRoot });
  return { repoPath, repoStatus: "cloned" };
}
