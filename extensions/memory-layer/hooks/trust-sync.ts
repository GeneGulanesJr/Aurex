import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { state } from "../state";
import { mem } from "../host/memory-client";
import { getKnownRepos } from "../host/project-detector";

interface TrustSyncDeps {
  state: typeof state;
  mem: typeof mem;
  getKnownRepos: typeof getKnownRepos;
}

export function registerTrustSync(pi: ExtensionAPI, deps: TrustSyncDeps) {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "bash") {
      const input = event.input as { command?: string };
      const cmd = input?.command || "";
      if (/\bgit\s+(pull|checkout|merge|rebase|reset|stash\s+pop)\b/.test(cmd) && deps.state.currentProject) {
        const repos = await deps.getKnownRepos();
        const repo = repos.find(r =>
          r.name.toLowerCase() === deps.state.currentProject!.toLowerCase()
        );
        if (repo) {
          deps.mem("sync-code-trust", {
            repo: repo.name,
            "changed-symbols-json": "{}",
          }).catch(() => {});
          ctx.ui.notify(`🔄 Memory: syncing trust scores after git operation on ${repo.name}`, "info");
        }
      }
    }
  });
}
