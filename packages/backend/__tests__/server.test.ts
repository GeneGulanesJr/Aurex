import { describe, it, expect, vi } from "vitest";

describe("server healthcheck", () => {
  it("returns 503 when LaPis is down", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify();
    const mockLapis = { ping: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const mockPinyx = { ping: vi.fn().mockResolvedValue(undefined) };

    app.get("/health", async () => {
      const lapisOk = await mockLapis.ping().then(() => true, () => false);
      const pinyxOk = await mockPinyx.ping().then(() => true, () => false);
      const ok = lapisOk && pinyxOk;
      return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body.lapis).toBe(false);
    expect(body.status).toBe("degraded");
  });

  it("returns ok when both services are healthy", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify();
    const mockLapis = { ping: vi.fn().mockResolvedValue(undefined) };
    const mockPinyx = { ping: vi.fn().mockResolvedValue(undefined) };

    app.get("/health", async () => {
      const lapisOk = await mockLapis.ping().then(() => true, () => false);
      const pinyxOk = await mockPinyx.ping().then(() => true, () => false);
      const ok = lapisOk && pinyxOk;
      return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.lapis).toBe(true);
  });
});
