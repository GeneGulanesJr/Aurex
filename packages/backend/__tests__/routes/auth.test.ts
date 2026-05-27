import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGlobalAuth } from "../../src/routes/auth";

describe("auth middleware", () => {
  it("passes through when apiKey is null", async () => {
    const app = Fastify();
    registerGlobalAuth(app, null);
    app.get("/api/test", async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/api/test" });
    expect(res.statusCode).toBe(200);
  });

  it("blocks requests without Authorization header when apiKey is set", async () => {
    const app = Fastify();
    registerGlobalAuth(app, "secret-key");
    app.get("/api/test", async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/api/test" });
    expect(res.statusCode).toBe(401);
  });

  it("blocks requests with wrong API key", async () => {
    const app = Fastify();
    registerGlobalAuth(app, "secret-key");
    app.get("/api/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: { authorization: "Bearer wrong-key" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows requests with correct API key", async () => {
    const app = Fastify();
    registerGlobalAuth(app, "secret-key");
    app.get("/api/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: { authorization: "Bearer secret-key" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("always allows /health endpoint", async () => {
    const app = Fastify();
    registerGlobalAuth(app, "secret-key");
    app.get("/health", async () => ({ status: "ok" }));

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("allows /health without auth when apiKey is set", async () => {
    const app = Fastify();
    registerGlobalAuth(app, "secret-key");
    app.get("/health", async () => ({ status: "ok" }));

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});
