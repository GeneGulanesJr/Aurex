# Aurex MiniMax Provider Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MiniMax (model: `MiniMax-M3`) as a first-class LLM provider in Aurex so users can configure it through the Integrations → Keys tab and assign it to any agent role.

**Architecture:** Aurex is gateway-mediated. **All LLM calls flow through PiNyx** — Aurex never talks to upstream providers directly. The provider abstraction lives in two places: a server-side `providerApi(id)` switch that maps a provider id to a PiNyx adapter name, and a frontend built-in list that pre-fills the form. Adding a provider is therefore a **config-layer change** that ships in three files plus tests.

**Tech Stack:** TypeScript, Fastify, React 19, Vite, Vitest, `@aurex/shared`, PiNyx (Rust gateway) configured via `PUT /api/config`.

**Task 0 result (confirmed):** MiniMax exposes two protocols. This plan uses the **OpenAI-Compatible** protocol (`https://api.minimax.io/v1`, model `MiniMax-M3`) because PiNyx's `openai-completions` adapter already speaks that shape. The Anthropic-compatible path (`/anthropic`) is out of scope but noted in OoS.

---

## File Structure

- Modify `packages/backend/src/routes/pinyx.ts` — add `minimax` to `providerApi()` switch and add a MiniMax model hint to the auto-detected default.
- Modify `packages/frontend/src/active/PinyxKeysTab.tsx` — append MiniMax to `BUILT_IN_PROVIDERS` so it appears as a one-click row.
- Modify `packages/backend/__tests__/routes/pinyx.test.ts` — extend coverage to assert `providerApi("minimax")` resolves to `openai-completions` and that POSTing a config with a MiniMax provider round-trips correctly.
- Modify `docs/configuration.md` (or create it if missing) — document the new provider.

---

## Task 0: Verify MiniMax's API protocol (gate, not code)

**Files:** none — research only.

- [ ] **Task 0 confirmed via MiniMax docs (platform.minimax.io):**
  - OpenAI-Compatible Base URL: `https://api.minimax.io/v1`
  - Anthropic-Compatible Base URL: `https://api.minimax.io/anthropic`
  - Model ID: `MiniMax-M3` (confirmed)
  - Pi SDK already has `--provider minimax` built in
  - This plan uses the OpenAI-Compatible path — `openai-completions` adapter ✓

---

## Task 1: Register MiniMax in the backend provider switch

**Files:**
- Modify: `packages/backend/src/routes/pinyx.ts`

The `providerApi(providerId)` switch (around line 70) maps a provider id to a PiNyx adapter string. MiniMax uses `openai-completions` (the default), so we only need an explicit case for clarity and forward-compat in case MiniMax ever ships a custom adapter.

- [ ] **Step 1: Read the current switch**

```bash
sed -n '70,82p' packages/backend/src/routes/pinyx.ts
```

Expected:
```ts
function providerApi(providerId: string): string {
  switch (providerId) {
    case "anthropic":
      return "anthropic-messages";
    case "google":
    case "gemini":
      return "google-generative-ai";
    default:
      return "openai-completions";
  }
}
```

- [ ] **Step 2: Add an explicit `minimax` case**

Edit the switch in `packages/backend/src/routes/pinyx.ts`:

```ts
function providerApi(providerId: string): string {
  switch (providerId) {
    case "anthropic":
      return "anthropic-messages";
    case "google":
    case "gemini":
      return "google-generative-ai";
    case "minimax":
      return "openai-completions";
    default:
      return "openai-completions";
  }
}
```

The case is functionally a no-op (default already returns `openai-completions`), but it documents intent and is the one place to update if MiniMax ever ships a custom adapter.

- [ ] **Step 3: Verify with grep**

```bash
grep -n "minimax" packages/backend/src/routes/pinyx.ts
```

Expected: one match — the new `case "minimax":` line.

---

## Task 2: Extend auto-detected default model hints

**Files:**
- Modify: `packages/backend/src/routes/pinyx.ts`

The `defaultModelHints` constant (around line 56) is what users see when no model hints have been saved. Currently every agent role points at `kilo/kilo-auto/free`. We don't change the *default* (Kilo is the only always-on option for first-run), but the **discovered-model fallback** in the `POST /api/pinyx/config` handler (the "all stub" branch around line 180) picks a `bestModel` for the user. MiniMax models will show up there automatically once a key is configured. No code change needed — confirm and move on.

- [ ] **Step 1: Confirm the auto-fill branch already works for any provider**

```bash
sed -n '178,205p' packages/backend/src/routes/pinyx.ts
```

Expected: `discoveredModels.find((m) => !m.id.includes("/free"))?.id ?? discoveredModels[0].id`. This branch is provider-agnostic — once `syncConfigToPinyx` ships the MiniMax provider with its model list, the discovered list contains `minimax/MiniMax-M3` (or whatever the canonical id is) and the auto-fill picks it. No edit required.

- [ ] **Step 2: (Optional, only if you want MiniMax as a true first-class default)** Decide whether to flip `defaultModelHints` to point at MiniMax. **Recommendation: do not.** Kilo's free tier is the right default for first-run; users can switch in the Models tab. This step is a no-op for the plan.

---

## Task 3: Add MiniMax to the frontend built-in providers list

**Files:**
- Modify: `packages/frontend/src/active/PinyxKeysTab.tsx`

The `BUILT_IN_PROVIDERS` array (around line 20) is what renders the "always-shown" rows in the Integrations → Keys tab. Users can already add MiniMax manually as a *custom* provider today — this task makes it appear as a one-click built-in alongside Kilo and Z.AI.

- [ ] **Step 1: Read the current list**

```bash
sed -n '20,23p' packages/frontend/src/active/PinyxKeysTab.tsx
```

Expected:
```ts
const BUILT_IN_PROVIDERS = [
  { id: "kilo", name: "Kilo Code", baseUrl: "https://api.kilo.ai/v1" },
  { id: "zai", name: "Z.AI Coding", baseUrl: "https://api.z.ai/api/coding/paas/v4" },
];
```

- [ ] **Step 2: Append the MiniMax entry**

Edit `packages/frontend/src/active/PinyxKeysTab.tsx`:

```ts
const BUILT_IN_PROVIDERS = [
  { id: "kilo", name: "Kilo Code", baseUrl: "https://api.kilo.ai/v1" },
  { id: "zai", name: "Z.AI Coding", baseUrl: "https://api.z.ai/api/coding/paas/v4" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimaxi.chat/v1" },
];
```

- [ ] **Step 3: Verify the new row appears in the UI**

Build the frontend and load Integrations → Keys. Expected: a third row "MiniMax" with an empty API key field. The save handler in `PinyxKeysTab.tsx` (around line 100) already iterates `BUILT_IN_PROVIDERS` and posts to `/api/pinyx/config`, so no further edits are required.

```bash
pnpm --filter @aurex/frontend run build
```

---

## Task 4: Add backend test coverage

**Files:**
- Modify: `packages/backend/__tests__/routes/pinyx.test.ts`

`providerApi` is currently untested because it's a private helper. The simplest coverage path is an end-to-end test of `POST /api/pinyx/config` with a MiniMax provider — this exercises the switch via `syncConfigToPinyx`.

- [ ] **Step 1: Read the existing POST test for reference**

```bash
sed -n '95,140p' packages/backend/__tests__/routes/pinyx.test.ts
```

Expected: a `describe` block that mocks `fetch`, posts a config with a provider, and asserts the response.

- [ ] **Step 2: Add a new test that posts a MiniMax provider**

Append to the `describe("PiNyx integration routes", ...)` block in `packages/backend/__tests__/routes/pinyx.test.ts`:

```ts
  it("accepts a MiniMax provider and tags it openai-completions", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", mockFetch);

    const app = Fastify();
    const lapis = createMockLapis();
    registerPinyxRoutes(app, { lapis });

    const res = await app.inject({
      method: "POST",
      url: "/api/pinyx/config",
      payload: {
        endpoint: "http://pinyx.example:7331",
        modelHints: defaultModelHints,
        providers: [
          { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.io/v1", apiKey: "sk-test" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers).toEqual([
      expect.objectContaining({ id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.io/v1", hasApiKey: true }),
    ]);

    // Inspect the PUT /api/config call that PiNyx receives
    const putCall = mockFetch.mock.calls.find(([url, init]) =>
      typeof url === "string" && url.endsWith("/api/config") && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const putBody = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(putBody.providers.minimax).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "sk-test",
    });
  });
```

- [ ] **Step 3: Run the new test in isolation**

```bash
cd packages/backend && npx vitest run __tests__/routes/pinyx.test.ts -t "MiniMax"
```

Expected: 1 passed.

- [ ] **Step 4: Run the full backend test suite**

```bash
cd packages/backend && npx vitest run
```

Expected: all prior tests still pass + the new one. Total should be `prior + 1`.

---

## Task 5: Update configuration docs

**Files:**
- Modify or create: `docs/configuration.md` (create if absent)

- [ ] **Step 1: Check whether the file exists**

```bash
ls docs/configuration.md 2>/dev/null || echo "MISSING"
```

- [ ] **Step 2: Add a "PiNyx Providers" section**

In `docs/configuration.md` (or the existing configuration section in `README.md`), add a short subsection documenting the three built-in providers:

```markdown
### Built-in PiNyx providers

| Provider | Base URL | Adapter | Notes |
|---|---|---|---|
| Kilo Code | `https://api.kilo.ai/v1` | `openai-completions` | Default for first-run; has a free tier (`/free` suffix). |
| Z.AI Coding | `https://api.z.ai/api/coding/paas/v4` | `openai-completions` | Anthropic-aliased coding models. |
| MiniMax | `https://api.minimax.io/v1` | `openai-completions` | OpenAI-compatible; set key in Integrations → Keys tab. |

Custom providers with any other base URL are also supported — they fall back to the `openai-completions` adapter.
```

- [ ] **Step 3: Verify the README still links to the right place**

```bash
grep -n "configuration\|PiNyx" README.md | head
```

Expected: an existing reference to PiNyx configuration. If README has its own provider table, update it too.

---

## Task 6: Manual end-to-end smoke test

**Files:** none — manual verification.

- [ ] **Step 1: Start the stack with a real MiniMax key**

```bash
# In .env or via the Integrations UI
export PINYX_ENDPOINT=http://host.docker.internal:7331
docker compose up --build
```

- [ ] **Step 2: Configure MiniMax in the UI**

Open Integrations → Keys → enter a MiniMax API key into the new MiniMax row → Save. Expected: row shows `hasApiKey: true`, Integrations → Models tab lists MiniMax models.

- [ ] **Step 3: Assign MiniMax to one agent role and run a mission**

In Integrations → Models, set the `worker` role to `minimax/MiniMax-M3` (or whatever canonical id Task 0 confirmed) and start a small mission ("add a console.log to src/index.ts"). Expected: the worker agent routes through PiNyx → MiniMax and produces a working diff.

- [ ] **Step 4: Verify cost/tokens in the dashboard**

After the mission completes, the telemetry bar should show MiniMax's token count and cost. If costs show as `$0.00` for a real key, PiNyx's cost lookup for MiniMax models is missing — file a follow-up to add a cost table in `pinyx.json`.

---

## Verification Checklist

- [ ] `pnpm --filter @aurex/backend test` — all tests pass, including new MiniMax coverage.
- [ ] `pnpm --filter @aurex/frontend build` — frontend builds without TS errors.
- [ ] Manual smoke test (Task 6) — mission runs end-to-end through MiniMax.
- [ ] No new dependencies added (this is a pure config-layer change).
- [ ] `git diff --stat` shows ≤ 4 files changed: `packages/backend/src/routes/pinyx.ts`, `packages/frontend/src/active/PinyxKeysTab.tsx`, `packages/backend/__tests__/routes/pinyx.test.ts`, plus the doc file.

---

## Out of Scope (flagged for follow-up)

1. **Cost table for MiniMax in PiNyx.** PiNyx needs `cost: { input, output, cache_read, cache_write }` per model to report real $ in the dashboard. Default behavior is `$0.00`. Track separately.
2. **Custom PiNyx adapter for MiniMax.** If MiniMax ever ships a non-OpenAI request shape, a new `api: "minimax-completions"` adapter is needed in PiNyx (Rust). Outside this Aurex plan.
3. **Per-mission model hints UX.** Today, `MissionConfig.modelHints` is a server-side field; the New Mission form doesn't expose it. If you want users to pick MiniMax per-mission (not just globally), the form needs a model-hint override field. Track separately.
4. **Anthropic-style streaming for MiniMax.** If MiniMax returns SSE in a non-OpenAI format, `chatStream` in `packages/backend/src/clients/pinyx-client.ts` may need adapter awareness. Assumed OpenAI SSE for now.
