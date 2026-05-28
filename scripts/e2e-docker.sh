#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.e2e.yml"
PROJECT_NAME="aurex-e2e"
TIMEOUT="${E2E_TIMEOUT:-120}"
PASSED=0
FAILED=0

cleanup() {
  echo ""
  echo "--- Cleanup ---"
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

log_pass() { echo "  ✅ $1"; PASSED=$((PASSED + 1)); }
log_fail() { echo "  ❌ $1"; FAILED=$((FAILED + 1)); }

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    log_pass "$name"
  else
    log_fail "$name"
  fi
}

check_visible() {
  local name="$1"
  shift
  local output
  output=$("$@" 2>&1) && log_pass "$name" || { log_fail "$name"; echo "    Output: $output"; }
}

assert_json() {
  local url="$1" expected="$2" label="$3"
  local body
  body=$(curl -s "$url" 2>/dev/null) || true
  if echo "$body" | grep -q "$expected"; then
    log_pass "$label"
  else
    log_fail "$label (got: ${body:0:120})"
  fi
}

echo "╔══════════════════════════════════════════╗"
echo "║   Aurex E2E Docker Compose Test          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- Prerequisites ---
echo "--- Prerequisites ---"
for cmd in docker curl; do
  if command -v "$cmd" >/dev/null 2>&1; then
    log_pass "$cmd is installed"
  else
    log_fail "$cmd is required but not installed"
    echo "FATAL: $cmd not found. Aborting."
    exit 1
  fi
done

# --- Build & Start ---
echo ""
echo "--- Building & Starting Stack ---"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up --build -d 2>&1 \
  || { echo "FATAL: docker compose up failed"; exit 1; }
log_pass "docker compose up succeeded"

# --- Wait for healthy ---
echo ""
echo "--- Waiting for services (timeout: ${TIMEOUT}s) ---"

wait_for_healthy() {
  local service="$1" elapsed=0
  while [ $elapsed -lt $TIMEOUT ]; do
    local state
    state=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' \
      "${PROJECT_NAME}-${service}-1" 2>/dev/null || echo "missing")
    if [ "$state" = "healthy" ]; then
      log_pass "$service is healthy (${elapsed}s)"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  log_fail "$service did not become healthy within ${TIMEOUT}s"
  echo "  Last logs:"
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs --tail=20 "$service" 2>/dev/null || true
  return 1
}

all_healthy=true
for svc in lapis pinyx-stub backend frontend; do
  if ! wait_for_healthy "$svc"; then
    all_healthy=false
  fi
done

if [ "$all_healthy" = "false" ]; then
  echo ""
  echo "FATAL: Not all services became healthy. Dumping logs:"
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs 2>/dev/null || true
  exit 1
fi

# --- Assertions ---
echo ""
echo "--- Assertions ---"

# 1. LaPis health
assert_json "http://localhost:9100/health" '"status":"ok"' "GET /health on LaPis returns ok"

# 2. PiNyx stub health
assert_json "http://localhost:7331/health" '"status":"ok"' "GET /health on PiNyx stub returns ok"

# 3. PiNyx stub models
assert_json "http://localhost:7331/v1/models" '"object":"list"' "GET /v1/models on PiNyx stub returns model list"

# 4. Backend health (direct)
assert_json "http://localhost:3000/health" '"status":"ok"' "GET /health on backend returns ok"

# 5. Frontend serves HTML
FRONTEND_STATUS=$(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8080/')
if [ "$FRONTEND_STATUS" = "200" ]; then
  log_pass "GET / on frontend returns 200"
else
  log_fail "GET / on frontend returned $FRONTEND_STATUS (expected 200)"
fi

# 6. Frontend proxies /health to backend
assert_json "http://localhost:8080/health" '"status":"ok"' "GET /health via frontend proxy returns ok"

# 7. Create mission via frontend proxy
MISSION_RESPONSE=$(curl -s -X POST "http://localhost:8080/api/missions" \
  -H "Content-Type: application/json" \
  -d '{"description":"E2E test mission"}')
if echo "$MISSION_RESPONSE" | grep -q '"missionId"'; then
  log_pass "POST /api/missions creates mission via frontend proxy"
else
  log_fail "POST /api/missions failed (got: ${MISSION_RESPONSE:0:120})"
fi

# 8. Get active missions
assert_json "http://localhost:8080/api/missions/active" '"missions"' "GET /api/missions/active returns missions list"

# 9. Get current mission (may be 404 if mission completed quickly, which is fine)
CURRENT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/api/missions/current")
if [ "$CURRENT_STATUS" = "200" ] || [ "$CURRENT_STATUS" = "404" ]; then
  log_pass "GET /api/missions/current returns $CURRENT_STATUS (acceptable)"
else
  log_fail "GET /api/missions/current returned unexpected $CURRENT_STATUS"
fi

# 10. WebSocket upgrade test
WS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://localhost:8080/ws")
if [ "$WS_STATUS" = "101" ]; then
  log_pass "WebSocket upgrade via frontend proxy returns 101"
else
  log_fail "WebSocket upgrade returned $WS_STATUS (expected 101)"
fi

# 11. Backend health reports LaPis + PiNyx connected
BACKEND_HEALTH=$(curl -s "http://localhost:3000/health")
if echo "$BACKEND_HEALTH" | grep -q '"lapis":true' && echo "$BACKEND_HEALTH" | grep -q '"pinyx":true'; then
  log_pass "Backend reports lapis:true and pinyx:true"
else
  log_fail "Backend health check shows degraded (got: ${BACKEND_HEALTH:0:120})"
fi

# --- Results ---
echo ""
echo "══════════════════════════════════════════"
echo "Results: $PASSED passed, $FAILED failed"
echo "══════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
