import type { FastifyInstance } from "fastify";
import { execFile } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";
import type { EventBus } from "../ws/events.js";
import type { UpdateStatusResponse } from "@aurex/shared";

interface UpdateRouteDeps {
  eventBus: EventBus;
  aurexRoot: string;
  gitMainBranch: string;
}

function exec(cmd: string, args: string[], opts?: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts?.cwd, timeout: 30_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

export function registerUpdateRoutes(app: FastifyInstance, deps: UpdateRouteDeps) {
  const { eventBus, aurexRoot, gitMainBranch } = deps;

  let currentSha: string | null = null;
  let latestSha: string | null = null;
  let behindBy = 0;
  let lastChecked: string | null = null;
  let updateAvailable = false;

  async function readHead(cwd: string): Promise<string> {
    return exec("git", ["rev-parse", "HEAD"], { cwd });
  }

  async function readRemoteHead(cwd: string, branch: string): Promise<string> {
    return exec("git", ["rev-parse", `origin/${branch}`], { cwd });
  }

  async function fetchOrigin(cwd: string): Promise<void> {
    await exec("git", ["fetch", "origin"], { cwd });
  }

  async function checkForUpdates(): Promise<void> {
    try {
      if (!currentSha) {
        currentSha = await readHead(aurexRoot);
      }
      await fetchOrigin(aurexRoot);
      latestSha = await readRemoteHead(aurexRoot, gitMainBranch);
      const localHead = await readHead(aurexRoot);

      if (localHead !== latestSha) {
        const logCount = await exec("git", [
          "log", "--oneline", `${localHead}..${latestSha}`,
        ], { cwd: aurexRoot }).catch(() => "");
        behindBy = logCount ? logCount.split("\n").filter(Boolean).length : 0;
        updateAvailable = true;
        lastChecked = new Date().toISOString();
        eventBus.emit({
          type: "update_available",
          currentSha: localHead,
          latestSha,
          behindBy,
        });
      } else {
        currentSha = localHead;
        behindBy = 0;
        updateAvailable = false;
        lastChecked = new Date().toISOString();
      }
    } catch (err) {
      console.warn("[update] Check failed:", err instanceof Error ? err.message : err);
    }
  }

  async function captureBuildSha(): Promise<void> {
    try {
      currentSha = await readHead(aurexRoot);
    } catch {
      currentSha = null;
    }
  }

  captureBuildSha();

  function scheduleDaily8am(): void {
    const now = new Date();
    const next8am = new Date(now);
    next8am.setHours(8, 0, 0, 0);
    if (next8am.getTime() <= now.getTime()) {
      next8am.setDate(next8am.getDate() + 1);
    }
    const delay = next8am.getTime() - now.getTime();
    setTimeout(async () => {
      await checkForUpdates();
      scheduleDaily8am();
    }, delay);
  }

  scheduleDaily8am();

  app.get("/api/update/status", async () => {
    if (!currentSha) {
      await captureBuildSha();
    }
    const status: UpdateStatusResponse = {
      updateAvailable,
      currentSha: currentSha ?? "",
      latestSha: latestSha ?? "",
      behindBy,
      lastChecked,
    };
    return status;
  });

  app.post("/api/update/check", async () => {
    await checkForUpdates();
    const status: UpdateStatusResponse = {
      updateAvailable,
      currentSha: currentSha ?? "",
      latestSha: latestSha ?? "",
      behindBy,
      lastChecked,
    };
    return status;
  });

  app.post("/api/update/apply", async (_request, reply) => {
    const flagPath = join(aurexRoot, ".update-pending");
    try {
      await writeFile(flagPath, "");
      updateAvailable = false;
      return { started: true };
    } catch (err) {
      reply.status(500);
      return { started: false, error: err instanceof Error ? err.message : "Failed to write update flag" };
    }
  });
}
