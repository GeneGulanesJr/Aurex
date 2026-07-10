import { describe, it, expect } from "vitest";
import { readFile, access } from "fs/promises";
import { cleanupExposureCatalogPath, resolveExposureCatalogPath } from "../../src/clients/bumblebee-catalog.js";
import type { LaPisClient } from "../../src/clients/lapis-client.js";

function mockLapis(settings: Record<string, unknown>): LaPisClient {
  const store = new Map(Object.entries(settings));
  return {
    getSetting: async (key: string) => store.get(key) as never,
    setSetting: async (key: string, value: unknown) => { store.set(key, value); },
  } as LaPisClient;
}

describe("bumblebee catalog helpers", () => {
  it("writes a temp catalog file when LaPis has entries", async () => {
    const lapis = mockLapis({
      bumblebee_catalog: {
        entries: [{ id: "e1", name: "Test", ecosystem: "npm", packagePattern: "lodash" }],
      },
    });
    const path = await resolveExposureCatalogPath(lapis, "test-id", "catalog-test");
    expect(path).toBeTruthy();
    const contents = await readFile(path!, "utf-8");
    expect(JSON.parse(contents).entries).toHaveLength(1);
    await cleanupExposureCatalogPath(path);
    await expect(access(path!)).rejects.toThrow();
  });

  it("returns undefined when no catalog is stored", async () => {
    const lapis = mockLapis({});
    const path = await resolveExposureCatalogPath(lapis, "missing");
    expect(path).toBeUndefined();
  });
});
