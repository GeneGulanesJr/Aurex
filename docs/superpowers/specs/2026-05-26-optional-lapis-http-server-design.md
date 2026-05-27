# Optional LaPis HTTP Server Design

Date: 2026-05-26
Status: Approved
Context: Aurex needs HTTP access to LaPis shared state, but LaPis must remain a regular Pi memory extension by default.

## 1. Goal

Add an optional HTTP server mode to LaPis/PiMemoryExtension without changing normal Pi extension behavior.

The existing usage remains unchanged:

```bash
lapis search --query "..."
lapis save --type decision --title "..." --content "..."
```

Aurex and other HTTP clients can explicitly start a local service:

```bash
lapis serve
```

Default endpoint:

```text
http://127.0.0.1:9100
```

## 2. Operating Model

`lapis serve` is an explicit CLI subcommand. Nothing starts automatically when Pi loads the memory-layer extension.

Defaults:

```text
host = 127.0.0.1
port = 9100
```

Configurable:

```bash
lapis serve --host 127.0.0.1 --port 9100
lapis serve --host 0.0.0.0 --port 9100
```

Aurex uses this optional mode with:

```bash
LAPIS_ENDPOINT=http://127.0.0.1:9100
```

Non-Aurex users do not need to run or know about HTTP mode.

## 3. HTTP API Shape

The HTTP server exposes the endpoints Aurex needs. It is a thin adapter over existing LaPis storage/domain logic and must not duplicate business rules in route handlers.

### Health

```http
GET /health
```

Returns:

```json
{ "status": "ok", "db": true }
```

### Mission State

```http
POST /missions
GET /missions/:id
PATCH /missions/:id/status
```

### Milestones / Working Units

```http
POST /missions/:missionId/milestones
PATCH /milestones/:id/status
POST /milestones/:milestoneId/units
PATCH /units/:id/status
```

### Handoffs / Contracts / Verdicts

```http
POST /units/:unitId/handoff
POST /milestones/:milestoneId/contracts
POST /contracts/:oldId/supersede
GET /milestones/:milestoneId/contracts
POST /verdicts
PATCH /verdicts/:id
GET /milestones/:milestoneId/verdicts
```

### Broadcasts / Research Findings

```http
POST /broadcasts
PATCH /broadcasts/:id
GET /missions/:missionId/broadcasts
POST /findings
PATCH /findings/:id
GET /missions/:missionId/findings
```

### Sessions / Memory / Cost / Retry

```http
POST /sessions
GET /milestones/:milestoneId/sessions
POST /memory/search
POST /costs
GET /missions/:missionId/costs
POST /milestones/:milestoneId/retry
POST /milestones/:milestoneId/rescope
```

### Compression

```http
POST /missions/:missionId/compression
```

For v1, this endpoint logs:

```text
[compression] Skipped — not implemented (trigger: X, missionId: Y)
```

and returns:

```json
{ "accepted": true, "skipped": true }
```

State compression implementation remains deferred.

## 4. Internal Architecture

Add HTTP mode as a separate module so CLI and extension code stay clean:

```text
PiMemoryExtension/
├── cli.js                         # existing CLI entry, adds serve branch only
├── memory-store.js                # still requires ./cli
├── db.js                          # existing DB/storage primitives
├── src/
│   ├── http/
│   │   ├── server.js              # create/start HTTP server
│   │   ├── routes.js              # route definitions
│   │   ├── handlers/
│   │   │   ├── missions.js
│   │   │   ├── milestones.js
│   │   │   ├── units.js
│   │   │   ├── handoffs.js
│   │   │   ├── contracts.js
│   │   │   ├── verdicts.js
│   │   │   ├── broadcasts.js
│   │   │   ├── findings.js
│   │   │   ├── sessions.js
│   │   │   ├── memory.js
│   │   │   ├── costs.js
│   │   │   └── compression.js
│   │   └── errors.js              # JSON error helpers
│   └── platform/storage/          # existing storage composition
```

### CLI integration

`cli.js` gets one new command branch:

```js
if (cmd === "serve") {
  const { startHttpServer } = require("./src/http/server");
  await startHttpServer({
    host: args.host ?? "127.0.0.1",
    port: Number(args.port ?? 9100),
  });
  return;
}
```

All existing CLI subcommands remain unchanged.

### HTTP framework

Use Node built-in `http` initially.

Reasons:

- LaPis is intentionally lightweight
- No Express/Fastify dependency for a Pi extension
- The API is simple JSON request/response
- Avoids surprising install/runtime weight

### Storage access

Handlers call existing DB helpers/repositories where possible. If a required table/repository does not exist, add it inside LaPis storage/domain modules rather than embedding business logic directly in the handler.

## 5. Behavior, Safety, and Compatibility

### Default behavior

No behavior changes unless the user explicitly runs:

```bash
lapis serve
```

Regular Pi memory extension usage remains unchanged.

### Binding safety

Default bind address:

```text
127.0.0.1:9100
```

Network exposure requires explicit opt-in:

```bash
lapis serve --host 0.0.0.0
```

If `--host 0.0.0.0` is used, print:

```text
[lapis serve] WARNING: binding to 0.0.0.0 exposes memory APIs on your network.
Use only on trusted networks or behind a proxy.
```

### Authentication

V1 has no auth because it binds to localhost by default.

Token authentication may be added later if users need network exposure, but it is not part of this version.

### Concurrency

Use existing LaPis DB transaction / busy-retry behavior. HTTP handlers must avoid long transactions.

### Error responses

All errors return JSON:

```json
{
  "error": {
    "code": "not_found",
    "message": "Mission not found"
  }
}
```

Common codes:

- `bad_request`
- `not_found`
- `conflict`
- `internal_error`

### Compatibility with Aurex

Aurex starts only if:

```http
GET /health
```

succeeds. If `lapis serve` is not running, Aurex healthcheck fails clearly. That is expected.

## 6. Testing

Add tests for:

1. CLI behavior
   - `lapis serve --port 0` starts without affecting existing commands
   - Existing CLI commands still work
2. Health endpoint
   - `GET /health` returns `{ "status": "ok", "db": true }`
3. JSON routing
   - Unknown route returns `404`
   - Invalid JSON returns `400`
   - Handler errors return structured JSON
4. Core Aurex endpoints
   - Create/get/update mission
   - Create milestone + working unit
   - Write/get verdict
   - Search memory
   - Register/get sessions
5. Safety defaults
   - Default host is `127.0.0.1`
   - `0.0.0.0` prints warning

## 7. Rollout

1. Implement `lapis serve`
2. Run PiMemoryExtension tests
3. Start locally:

```bash
lapis serve --port 9100
```

4. Point Aurex to it:

```bash
LAPIS_ENDPOINT=http://127.0.0.1:9100
```

5. Verify Aurex `/health` passes

## 8. Non-goals for v1

- No automatic startup from Pi extension
- No token/auth system
- No websocket/SSE from LaPis
- No state compression implementation beyond skip logging
- No frontend/dashboard for LaPis
- No network exposure by default

## 9. Self-review

- No placeholders or TBDs remain.
- Optional mode is explicit and does not affect default extension behavior.
- HTTP endpoint set matches Aurex's `LaPisClient` contract.
- Safety defaults are explicit: localhost-only bind, warning for `0.0.0.0`.
- Compression is intentionally stubbed and logged, aligned with Aurex state-compression deferral.
