import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { ExposureCatalog } from "@aurex/shared";
import type { LaPisClient } from "./lapis-client.js";

export async function resolveExposureCatalogPath(
  lapis: LaPisClient,
  id: string,
  prefix = "bumblebee-catalog",
): Promise<string | undefined> {
  const storedCatalog = await lapis.getSetting<ExposureCatalog>("bumblebee_catalog");
  if (!storedCatalog?.entries?.length) return undefined;
  const catalogFile = join(tmpdir(), `${prefix}-${id}.json`);
  await writeFile(catalogFile, JSON.stringify(storedCatalog), "utf-8");
  return catalogFile;
}

export async function cleanupExposureCatalogPath(catalogPath: string | undefined): Promise<void> {
  if (!catalogPath) return;
  await unlink(catalogPath).catch(() => {});
}
