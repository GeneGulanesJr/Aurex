import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerGlobalAuth, verifyJwt } from "../../src/routes/auth";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => "mocked-jwks"),
}));

import { jwtVerify, createRemoteJWKSet } from "jose";
const mockedJwtVerify = vi.mocked(jwtVerify);
const mockedCreateRemoteJWKSet = vi.mocked(createRemoteJWKSet);

const TEST_DOMAIN = "test.us.auth0.com";
const TEST_AUDIENCE = "https://api.test.io";
const VALID_TOKEN = "valid.jwt.token";

describe("auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks requests without Authorization header", async () => {
    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/api/test", async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/api/test" });
    expect(res.statusCode).toBe(401);
  });

  it("blocks requests with invalid/expired JWT", async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error("JWT expired"));

    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/api/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: { authorization: "Bearer bad-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows requests with valid JWT and sets request.user", async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "auth0|123",
        email: "test@example.com",
        name: "Test User",
        picture: "https://img.example.com/photo.jpg",
      },
      protectedHeader: {},
    } as any);

    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/api/test", async (req) => ({ user: req.user }));

    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toEqual({
      sub: "auth0|123",
      email: "test@example.com",
      name: "Test User",
      picture: "https://img.example.com/photo.jpg",
    });
  });


  it("caches JWKS resolvers per Auth0 domain", async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: "auth0|123" },
      protectedHeader: {},
    } as any);

    await verifyJwt(VALID_TOKEN, "tenant-a.us.auth0.com", TEST_AUDIENCE);
    await verifyJwt(VALID_TOKEN, "tenant-b.us.auth0.com", TEST_AUDIENCE);
    await verifyJwt(VALID_TOKEN, "tenant-a.us.auth0.com", TEST_AUDIENCE);

    expect(mockedCreateRemoteJWKSet).toHaveBeenCalledTimes(2);
    expect(mockedCreateRemoteJWKSet).toHaveBeenNthCalledWith(
      1,
      new URL("https://tenant-a.us.auth0.com/.well-known/jwks.json"),
    );
    expect(mockedCreateRemoteJWKSet).toHaveBeenNthCalledWith(
      2,
      new URL("https://tenant-b.us.auth0.com/.well-known/jwks.json"),
    );
  });

  it("always allows /health endpoint", async () => {
    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/health", async () => ({ status: "ok" }));

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("skips auth for /ws paths", async () => {
    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/ws/test", async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/ws/test" });
    expect(res.statusCode).toBe(200);
  });

  it("skips auth for /api/github/callback", async () => {
    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/api/github/callback", async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/api/github/callback" });
    expect(res.statusCode).toBe(200);
  });

  it("skips auth for skip paths with query strings", async () => {
    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/api/github/callback", async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/api/github/callback?code=abc&state=xyz" });
    expect(res.statusCode).toBe(200);
  });

  it("skips auth for /health with query string", async () => {
    const app = Fastify();
    registerGlobalAuth(app, TEST_DOMAIN, TEST_AUDIENCE);
    app.get("/health", async () => ({ status: "ok" }));

    const res = await app.inject({ method: "GET", url: "/health?format=json" });
    expect(res.statusCode).toBe(200);
  });
});
