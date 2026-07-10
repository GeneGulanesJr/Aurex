import type { ReviewReport } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";

const REVIEW_INDEX_KEY = (repoName: string) => `repo:${repoName}:reviews`;
const REVIEW_KEY = (id: string) => `review:${id}`;
const LATEST_KEY = (repoName: string) => `repo:${repoName}:latest_review_id`;

export async function saveReview(lapis: LaPisClient, report: ReviewReport): Promise<void> {
  await lapis.setSetting(REVIEW_KEY(report.id), report);
  const index = await lapis.getSetting<{ reviewIds: string[] }>(REVIEW_INDEX_KEY(report.repoName));
  const reviewIds = index?.reviewIds ?? [];
  if (!reviewIds.includes(report.id)) {
    await lapis.setSetting(REVIEW_INDEX_KEY(report.repoName), { reviewIds: [...reviewIds, report.id] });
  }
  await lapis.setSetting(LATEST_KEY(report.repoName), report.id);
}

export async function getLatestReview(lapis: LaPisClient, repoName: string): Promise<ReviewReport | null> {
  const latestId = await lapis.getSetting<string>(LATEST_KEY(repoName));
  if (!latestId) return null;
  return getReview(lapis, latestId);
}

export async function getReview(lapis: LaPisClient, reviewId: string): Promise<ReviewReport | null> {
  return lapis.getSetting<ReviewReport>(REVIEW_KEY(reviewId));
}

export async function updateIssueStatus(
  lapis: LaPisClient,
  reviewId: string,
  issueId: string,
  status: NonNullable<ReviewReport["issues"][number]["status"]>,
): Promise<ReviewReport | null> {
  const report = await getReview(lapis, reviewId);
  if (!report) return null;
  const idx = report.issues.findIndex((i) => i.id === issueId);
  if (idx < 0) return null;
  const updated: ReviewReport = {
    ...report,
    issues: report.issues.map((issue, i) =>
      i === idx ? { ...issue, status } : issue,
    ),
  };
  await lapis.setSetting(REVIEW_KEY(reviewId), updated);
  return updated;
}
