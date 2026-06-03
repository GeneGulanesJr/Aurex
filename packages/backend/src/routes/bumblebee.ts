import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { BumblebeeRunner } from "../orchestrator/bumblebee-runner.js";
import type { BumblebeeClient } from "../clients/bumblebee-client.js";

interface BumblebeeRouteDeps {
  lapis: LaPisClient;
  bumblebeeClient: BumblebeeClient;
  bumblebeeRunner: BumblebeeRunner;
}

export async function bumblebeeRoutes(app: FastifyInstance, deps: BumblebeeRouteDeps) {
  const { lapis, bumblebeeClient, bumblebeeRunner } = deps;

  app.get("/api/bumblebee/status", async () => {
    return bumblebeeClient.isAvailable();
  });

  app.post("/api/missions/:missionId/scans", async (req: FastifyRequest<{ Params: { missionId: string }; Body: { profile?: "baseline" | "project" | "deep"; ecosystems?: string[] } }>, reply: FastifyReply) => {
    const { missionId } = req.params;
    const { profile, ecosystems } = req.body || {};

    const mission = await lapis.getMission(missionId).catch(() => null);
    if (!mission) {
      return reply.code(404).send({ error: "Mission not found" });
    }

    const root = mission.configJson.repoRoot || process.env.REPO_ROOT || "/workspace";
    const result = await bumblebeeRunner.triggerScan(missionId, { profile, ecosystems, root });
    return reply.code(201).send({ scanId: result.scanId, status: "running" as const });
  });

  app.get("/api/missions/:missionId/scans", async (req: FastifyRequest<{ Params: { missionId: string } }>) => {
    const { missionId } = req.params;
    const scans = await bumblebeeRunner.listScans(missionId);
    return { scans };
  });

  app.get("/api/missions/:missionId/scans/:scanId", async (req: FastifyRequest<{ Params: { missionId: string; scanId: string } }>, reply: FastifyReply) => {
    const { scanId } = req.params;
    const scan = await bumblebeeRunner.getScan(scanId);
    if (!scan) {
      return reply.code(404).send({ error: "Scan not found" });
    }
    return { scan, findings: [], packageCount: scan.summary?.totalPackages ?? 0 };
  });

  app.get("/api/bumblebee/catalog", async () => {
    const catalog = await lapis.getSetting("bumblebee_catalog");
    return { catalog };
  });

  app.post("/api/bumblebee/catalog", async (req: FastifyRequest<{ Body: { schemaVersion: string; entries: Array<{ id: string; name: string; ecosystem: string; package: string; versions: string[]; severity: "critical" | "high" | "medium" | "low" }> } }>, reply: FastifyReply) => {
    const catalog = req.body;
    if (!catalog.schemaVersion || !Array.isArray(catalog.entries)) {
      return reply.code(400).send({ error: "Invalid catalog format. Requires schemaVersion and entries." });
    }
    await lapis.setSetting("bumblebee_catalog", catalog);
    return { saved: true };
  });
}
