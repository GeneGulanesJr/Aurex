import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";

interface CodeContextDeps {
  lapis: LaPisClient;
}

export function registerCodeContextRoutes(app: FastifyInstance, deps: CodeContextDeps) {
  const { lapis } = deps;

  app.get("/api/missions/:missionId/code/summary", async (req) => {
    const { missionId } = req.params as { missionId: string };
    const repoName = await lapis.getSetting<string>(`mission:${missionId}:repoName`);
    if (!repoName) {
      console.warn(`[code-context] No repoName found for mission ${missionId}. Code context will be empty.`);
      return { files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } };
    }
    const summary = await lapis.getCodeSummary(repoName).catch((err) => {
      console.warn(`[code-context] Failed to get code summary for repo ${repoName}:`, err instanceof Error ? err.message : err);
      return { files: 0, symbols: 0, edges: 0, modules: [], entryPoints: [], cycles: { count: 0, paths: [] } };
    });
    return summary;
  });

  app.get("/api/missions/:missionId/code/graph", async (req) => {
    const { missionId } = req.params as { missionId: string };
    const repoName = await lapis.getSetting<string>(`mission:${missionId}:repoName`);
    if (!repoName) {
      return { nodes: [], edges: [], cycles: [] };
    }
    return lapis.getCodeGraph(repoName);
  });

  app.get("/api/missions/:missionId/code/hotspots", async (req) => {
    const { missionId } = req.params as { missionId: string };
    const repoName = await lapis.getSetting<string>(`mission:${missionId}:repoName`);
    if (!repoName) {
      return { files: [] };
    }
    return lapis.getCodeHotspots(repoName);
  });
}
