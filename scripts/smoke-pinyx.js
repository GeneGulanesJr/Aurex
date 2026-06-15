#!/usr/bin/env node
/**
 * Integration smoke test — Aurex ↔ PiNyx LLM Gateway
 * 
 * Prerequisites:
 *   - PiNyx running on port 7331 (cd PiNyx/pinyx && cargo run)
 *   - lapis serve running on port 9100
 * 
 * Run: pnpm smoke:pinyx
 */

const PINYX = process.env.PINYX_URL || 'http://127.0.0.1:7331';
const LAPIS = process.env.LAPIS_URL || 'http://127.0.0.1:9100';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data };
}

async function main() {
  console.log('🔥 Aurex ↔ PiNyx Integration Smoke Test\n');
  console.log(`PiNyx: ${PINYX}`);
  console.log(`LaPis: ${LAPIS}\n`);

  // ─── PiNyx Health ───
  console.log('--- PiNyx Health ---');
  await check('GET /health returns ok', async () => {
    const res = await request('GET', `${PINYX}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'ok', `Expected ok, got ${res.body.status}`);
  });

  // ─── PiNyx Models ───
  console.log('\n--- PiNyx Models ---');
  await check('GET /v1/models returns model list', async () => {
    const res = await request('GET', `${PINYX}/v1/models`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.object === 'list', 'Expected object: list');
    assert(Array.isArray(res.body.data), 'Expected data array');
    console.log(`    Models available: ${res.body.data.length}`);
    for (const m of res.body.data.slice(0, 5)) {
      console.log(`      - ${m.id} (${m.owned_by})`);
    }
  });

  // ─── LaPis via PiNyx test (verify both services running) ───
  console.log('\n--- LaPis Health (via same smoke test) ---');
  await check('GET LaPis /health returns ok', async () => {
    const res = await request('GET', `${LAPIS}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'ok', `Expected ok, got ${res.body.status}`);
  });

  // ─── OpenAI-compatible chat endpoint ───
  console.log('\n--- PiNyx Chat Proxy ---');
  let chatTested = false;
  await check('POST /v1/chat/completions accepts request (may fail if no valid key)', async () => {
    const res = await request('POST', `${PINYX}/v1/chat/completions`, {
      model: 'test-model',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    // We expect either a successful response or a clear error about model/key
    // 200 = works, 400 = model not found (expected if no matching model), 401/500 = key issue
    assert(
      res.status === 200 || res.status === 400 || res.status === 401 || res.status === 502 || res.status === 500,
      `Unexpected status ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`
    );
    if (res.status === 200) {
      assert(res.body.choices, 'Expected choices in response');
      assert(res.body.usage, 'Expected usage in response');
      chatTested = true;
      console.log(`    ✨ Chat succeeded! Tokens: ${res.body.usage?.total_tokens}`);
    } else {
      console.log(`    ℹ️  Chat returned ${res.status} (expected without valid API key/model)`);
    }
  });

  // ─── Provider Config ───
  console.log('\n--- PiNyx Config ---');
  await check('GET /api/config returns config', async () => {
    const res = await request('GET', `${PINYX}/api/config`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.gateway, 'Expected gateway config');
    assert(res.body.providers, 'Expected providers config');
    const providerNames = Object.keys(res.body.providers);
    console.log(`    Providers: ${providerNames.join(', ')}`);
    assert(providerNames.length > 0, 'Expected at least one provider');
  });

  // ─── Key Status ───
  console.log('\n--- PiNyx Key Status ---');
  await check('GET /api/keys returns key status', async () => {
    const res = await request('GET', `${PINYX}/api/keys`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    for (const [name, info] of Object.entries(res.body.providers || {})) {
      console.log(`    ${name}: ${info.status}${info.masked ? ` (${info.masked})` : ''}`);
    }
  });

  // ─── Aurex PinyxClient contract verification ───
  console.log('\n--- Aurex PinyxClient Contract ---');
  await check('PinyxClient.ping() works (GET /v1/models)', async () => {
    const res = await request('GET', `${PINYX}/v1/models`);
    assert(res.status === 200, `Ping failed: ${res.status}`);
  });

  // ─── Full stack: create mission via LaPis ───
  console.log('\n--- Full Stack (LaPis + PiNyx) ---');
  await check('Create mission in LaPis while PiNyx is running', async () => {
    const res = await request('POST', `${LAPIS}/missions`, {
      description: 'Full stack smoke test',
      config: { modelHints: {} },
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    console.log(`    Mission: ${res.body.id}`);
  });

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (chatTested) {
    console.log('🎉 Full chat proxy verified!');
  } else {
    console.log('ℹ️  Chat proxy not tested (needs valid API key + model)');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
