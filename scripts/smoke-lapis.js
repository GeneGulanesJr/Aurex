#!/usr/bin/env node
/**
 * Integration smoke test — Aurex LaPisClient ↔ LaPis HTTP Server
 * 
 * Prerequisites: lapis serve --port 9100 must be running
 * Run: node scripts/smoke-lapis.js
 */

const LAPIS = 'http://127.0.0.1:9100';

async function request(method, path, body) {
  const res = await fetch(`${LAPIS}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data };
}

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

async function main() {
  console.log('🔥 Aurex ↔ LaPis Integration Smoke Test\n');
  console.log(`Target: ${LAPIS}\n`);

  // Health
  console.log('--- Health ---');
  await check('GET /health returns ok', async () => {
    const res = await request('GET', '/health');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'ok', `Expected ok, got ${res.body.status}`);
    assert(res.body.db === true, 'Expected db: true');
  });

  let missionId, milestoneId, unitId, contractId;

  // Mission lifecycle
  console.log('\n--- Mission Lifecycle ---');
  await check('POST /missions creates mission', async () => {
    const res = await request('POST', '/missions', { description: 'Smoke test mission', config: { modelHints: {} } });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.id, 'Expected id');
    assert(res.body.description === 'Smoke test mission');
    missionId = res.body.id;
  });

  await check('GET /missions/:id retrieves mission', async () => {
    const res = await request('GET', `/missions/${missionId}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.description === 'Smoke test mission');
  });

  await check('PATCH /missions/:id/status updates status', async () => {
    const res = await request('PATCH', `/missions/${missionId}/status`, { status: 'running' });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // Milestone lifecycle
  console.log('\n--- Milestone Lifecycle ---');
  await check('POST /missions/:id/milestones creates milestone', async () => {
    const res = await request('POST', `/missions/${missionId}/milestones`, { title: 'Phase 1', description: 'Setup', orderIndex: 0 });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    milestoneId = res.body.id;
  });

  await check('PATCH /milestones/:id/status updates status', async () => {
    const res = await request('PATCH', `/milestones/${milestoneId}/status`, { status: 'in_progress' });
    assert(res.status === 200);
  });

  // Working units
  console.log('\n--- Working Units ---');
  await check('POST /milestones/:id/units creates unit', async () => {
    const res = await request('POST', `/milestones/${milestoneId}/units`, { description: 'Build feature', declaredPaths: ['src/feat.ts'], declaredModules: [] });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    unitId = res.body.id;
  });

  await check('POST /units/:id/handoff writes handoff', async () => {
    const res = await request('POST', `/units/${unitId}/handoff`, {
      featureName: 'Smoke feature', description: 'Test', gitCommitHash: 'abc123',
      implemented: '', remaining: '', rationale: '', assumptions: '',
      unresolvedUncertainties: '', errorsEncountered: '', commandsRun: [],
    });
    assert(res.status === 200);
    assert(res.body.accepted === true);
  });

  // Contracts
  console.log('\n--- Validation Contracts ---');
  await check('POST /milestones/:id/contracts creates contract', async () => {
    const res = await request('POST', `/milestones/${milestoneId}/contracts`, {
      content: { criteria: ['works'], testCommands: ['npm test'], acceptanceBehavior: 'green' },
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    contractId = res.body.id;
    assert(res.body.version === 1);
  });

  await check('GET /milestones/:id/contracts returns history', async () => {
    const res = await request('GET', `/milestones/${milestoneId}/contracts`);
    assert(res.status === 200);
    assert(res.body.length >= 1);
  });

  // Verdicts
  console.log('\n--- Verdicts ---');
  await check('POST /verdicts writes verdict', async () => {
    const res = await request('POST', '/verdicts', {
      sessionId: 'smoke-session', milestoneId, contractId,
      validatorType: 'validator_scrutiny', verdict: 'pass',
      findings: 'All good', failedUnitIds: [],
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.verdict === 'pass');
  });

  await check('GET /milestones/:id/verdicts returns verdicts', async () => {
    const res = await request('GET', `/milestones/${milestoneId}/verdicts`);
    assert(res.status === 200);
    assert(res.body.length >= 1);
  });

  // Broadcasts
  console.log('\n--- Broadcasts ---');
  await check('POST /broadcasts writes broadcast', async () => {
    const res = await request('POST', '/broadcasts', {
      agentId: 'smoke-worker', missionId, authorType: 'worker',
      category: 'info', title: 'Progress', content: 'Moving along',
    });
    assert(res.status === 201);
  });

  await check('GET /missions/:id/broadcasts returns broadcasts', async () => {
    const res = await request('GET', `/missions/${missionId}/broadcasts`);
    assert(res.status === 200);
    assert(res.body.length >= 1);
  });

  // Research findings
  console.log('\n--- Research Findings ---');
  await check('POST /findings writes finding', async () => {
    const res = await request('POST', '/findings', {
      agentId: 'smoke-worker', missionId, domain: ['testing'],
      title: 'Test insight', content: 'Found something', relevance: 'high',
    });
    assert(res.status === 201);
  });

  await check('GET /missions/:id/findings returns findings', async () => {
    const res = await request('GET', `/missions/${missionId}/findings`);
    assert(res.status === 200);
    assert(res.body.length >= 1);
  });

  // Sessions
  console.log('\n--- Agent Sessions ---');
  await check('POST /sessions registers session', async () => {
    const res = await request('POST', '/sessions', {
      agentType: 'worker', sessionId: 'smoke-session', missionId, milestoneId, unitId,
    });
    assert(res.status === 200);
  });

  await check('GET /milestones/:id/sessions returns sessions', async () => {
    const res = await request('GET', `/milestones/${milestoneId}/sessions`);
    assert(res.status === 200);
    assert(res.body.length >= 1);
  });

  // Cost tracking
  console.log('\n--- Cost Tracking ---');
  await check('POST /costs logs cost entry', async () => {
    const res = await request('POST', '/costs', {
      missionId, agentSessionId: 'smoke-session', model: 'gpt-4',
      promptTokens: 500, completionTokens: 200, cost: 0.35,
      timestamp: new Date().toISOString(),
    });
    assert(res.status === 200);
  });

  await check('GET /missions/:id/costs returns summary', async () => {
    const res = await request('GET', `/missions/${missionId}/costs`);
    assert(res.status === 200);
    assert(res.body.totalCost === 0.35);
    assert(res.body.entries === 1);
  });

  // Retry / Rescope
  console.log('\n--- Retry / Rescope ---');
  await check('POST /milestones/:id/retry increments retry', async () => {
    const res = await request('POST', `/milestones/${milestoneId}/retry`, {});
    assert(res.status === 200);
    assert(res.body.retries >= 1);
  });

  await check('POST /milestones/:id/rescope logs rescope', async () => {
    const res = await request('POST', `/milestones/${milestoneId}/rescope`, {
      contractId, reason: 'Test rescope', previousScope: 'old', newScope: 'new',
    });
    assert(res.status === 200);
  });

  // Compression (real)
  console.log('\n--- Compression ---');
  await check('POST /missions/:id/compression returns CompressionResult', async () => {
    const res = await request('POST', `/missions/${missionId}/compression`, { trigger: 'manual' });
    assert(res.status === 200);
    assert(typeof res.body.summary === 'string' || res.body.summary === null);
    assert(typeof res.body.tokensSaved === 'number');
    assert(res.body.tokensSaved >= 0);
    // error is optional; if present, must be a string
    if (res.body.error !== undefined) {
      assert(typeof res.body.error === 'string');
    }
  });

  // Memory search
  console.log('\n--- Memory ---');
  await check('POST /memory/search searches memory', async () => {
    const res = await request('POST', '/memory/search', { query: 'test', limit: 5 });
    assert(res.status === 200);
    assert(Array.isArray(res.body));
  });

  // Error handling
  console.log('\n--- Error Handling ---');
  await check('GET /missions/:nonexistent returns 404', async () => {
    const res = await request('GET', '/missions/nonexistent-id');
    assert(res.status === 404);
    assert(res.body.error.code === 'not_found');
  });

  await check('GET /nonexistent returns 404', async () => {
    const res = await request('GET', '/does-not-exist');
    assert(res.status === 404);
  });

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
