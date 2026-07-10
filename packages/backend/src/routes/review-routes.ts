import type { FastifyInstance } from "fastify";
import type { IssueStatus } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { BumblebeeClient } from "../clients/bumblebee-client.js";
import { exportReviewMarkdown } from "../review/fix-prompt-builder.js";
import { runReview } from "../review/review-generator.js";
import { getLatestReview, getReview, saveReview, updateIssueStatus } from "../review/review-store.js";

interface ReviewRouteDeps {
  lapis: LaPisClient;
  bumblebeeClient?: BumblebeeClient;
  buildReadinessProfile: (repoName: string, repoPath: string) => Promise<import("@aurex/shared").ReviewReadinessProfile>;
}

export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRouteDeps): void {
  const { lapis, bumblebeeClient, buildReadinessProfile } = deps;

  app.post("/api/repos/:repoName/review", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const body = (request.body ?? {}) as { forceRescan?: boolean };
    const { report } = await runReview(
      { lapis, bumblebeeClient, buildReadinessProfile },
      repoName,
      { forceRescan: body.forceRescan === true },
    );
    if (report.status === "failed" && report.issues.length === 0) {
      return reply.status(404).send({ error: report.errors?.[0] ?? "Review failed", report });
    }
    await saveReview(lapis, report);
    return reply.code(201).send({ report });
  });

  app.get("/api/repos/:repoName/review", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const report = await getLatestReview(lapis, repoName);
    if (!report) {
      return reply.status(404).send({ error: "No review found. Run POST /api/repos/:repoName/review first." });
    }
    return { report };
  });

  app.get("/api/repos/:repoName/review/:reviewId/export", async (request, reply) => {
    const { repoName, reviewId } = request.params as { repoName: string; reviewId: string };
    const report = await getReview(lapis, reviewId);
    if (!report || report.repoName !== repoName) {
      return reply.status(404).send({ error: "Review not found" });
    }
    const markdown = exportReviewMarkdown(repoName, report.issues);
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return markdown;
  });

  app.get("/api/repos/:repoName/review/:reviewId", async (request, reply) => {
    const { repoName, reviewId } = request.params as { repoName: string; reviewId: string };
    const report = await getReview(lapis, reviewId);
    if (!report || report.repoName !== repoName) {
      return reply.status(404).send({ error: "Review not found" });
    }
    return { report };
  });

  app.patch("/api/repos/:repoName/review/:reviewId/issues/:issueId", async (request, reply) => {
    const { repoName, reviewId, issueId } = request.params as {
      repoName: string;
      reviewId: string;
      issueId: string;
    };
    const body = request.body as { status?: IssueStatus };
    if (!body?.status) {
      return reply.status(400).send({ error: "status is required" });
    }
    const allowed: IssueStatus[] = ["open", "acknowledged", "dismissed", "copied"];
    if (!allowed.includes(body.status)) {
      return reply.status(400).send({ error: "Invalid status" });
    }
    const report = await updateIssueStatus(lapis, reviewId, issueId, body.status);
    if (!report || report.repoName !== repoName) {
      return reply.status(404).send({ error: "Review or issue not found" });
    }
    return { report };
  });

  app.get("/api/repos/:repoName/graph", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await lapis.getSetting<string>(`repo:${repoName}:path`);
    if (!repoPath) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }
    try {
      return await lapis.getCodeGraph(repoName);
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : "Graph not available. Run review first.",
      });
    }
  });
}
