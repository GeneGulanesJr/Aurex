const { createDb, resetDb, sqlJson, sqlRun } = require('../db');
const { createAurexRepository } = require('../src/platform/storage/repositories/aurex');

describe('Aurex HTTP Server', () => {
  beforeAll(() => {
    resetDb();
    createDb({ db_path: ':memory:' });
  });
  afterAll(() => resetDb());

describe('DB schema migration', () => {

  it('creates missions table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='missions'");
    expect(rows.length).toBe(1);
  });

  it('creates milestones table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='milestones'");
    expect(rows.length).toBe(1);
  });

  it('creates working_units table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='working_units'");
    expect(rows.length).toBe(1);
  });

  it('creates validation_contracts table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='validation_contracts'");
    expect(rows.length).toBe(1);
  });

  it('creates validation_verdicts table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='validation_verdicts'");
    expect(rows.length).toBe(1);
  });

  it('creates broadcasts table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='broadcasts'");
    expect(rows.length).toBe(1);
  });

  it('creates research_findings table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='research_findings'");
    expect(rows.length).toBe(1);
  });

  it('creates agent_sessions table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_sessions'");
    expect(rows.length).toBe(1);
  });

  it('creates cost_entries table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='cost_entries'");
    expect(rows.length).toBe(1);
  });

  it('creates rescope_events table after migration', () => {
    const rows = sqlJson("SELECT name FROM sqlite_master WHERE type='table' AND name='rescope_events'");
    expect(rows.length).toBe(1);
  });
});

describe('Aurex repository', () => {
  let repo;

  beforeAll(() => {
    repo = createAurexRepository({ sqlJson, sqlRun });
  });

  it('inserts and retrieves a mission', () => {
    sqlRun(
      "INSERT INTO missions (id, description, status, config_json) VALUES (?, ?, ?, ?)",
      ['m1', 'Test mission', 'planning', '{"modelHints":{}}']
    );
    const rows = repo.getMission('m1');
    expect(rows.length).toBe(1);
    expect(rows[0].description).toBe('Test mission');
    expect(rows[0].status).toBe('planning');
  });

  it('updates mission status', () => {
    repo.updateMissionStatus('m1', 'running');
    const rows = repo.getMission('m1');
    expect(rows[0].status).toBe('running');
  });

  it('inserts and retrieves a milestone', () => {
    sqlRun(
      "INSERT INTO milestones (id, mission_id, title, order_index, status) VALUES (?, ?, ?, ?, ?)",
      ['ms1', 'm1', 'Setup', 0, 'planned']
    );
    const rows = repo.getMilestone('ms1');
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Setup');
  });

  it('updates milestone status', () => {
    repo.updateMilestoneStatus('ms1', 'in_progress');
    const rows = repo.getMilestone('ms1');
    expect(rows[0].status).toBe('in_progress');
  });

  it('inserts and retrieves a working unit', () => {
    sqlRun(
      "INSERT INTO working_units (id, milestone_id, description, status) VALUES (?, ?, ?, ?)",
      ['wu1', 'ms1', 'Implement X', 'spawned']
    );
    const rows = repo.getWorkingUnit('wu1');
    expect(rows.length).toBe(1);
    expect(rows[0].description).toBe('Implement X');
  });

  it('updates working unit status', () => {
    repo.updateWorkingUnitStatus('wu1', 'working');
    const rows = repo.getWorkingUnit('wu1');
    expect(rows[0].status).toBe('working');
  });

  it('inserts a contract and retrieves history', () => {
    sqlRun(
      "INSERT INTO validation_contracts (id, milestone_id, version, content) VALUES (?, ?, ?, ?)",
      ['vc1', 'ms1', 1, '{"criteria":[],"testCommands":[],"acceptanceBehavior":""}']
    );
    const history = repo.getContractHistory('ms1');
    expect(history.length).toBe(1);
    expect(history[0].id).toBe('vc1');
  });

  it('supersedes a contract', () => {
    sqlRun(
      "INSERT INTO validation_contracts (id, milestone_id, version, content, supersedes) VALUES (?, ?, ?, ?, ?)",
      ['vc2', 'ms1', 2, '{"criteria":[],"testCommands":[],"acceptanceBehavior":""}', 'vc1']
    );
    sqlRun("UPDATE validation_contracts SET superseded_by = ? WHERE id = ?", ['vc2', 'vc1']);
    const history = repo.getContractHistory('ms1');
    expect(history.length).toBe(2);
  });

  it('inserts and retrieves a verdict', () => {
    sqlRun(
      "INSERT INTO validation_verdicts (id, milestone_id, contract_id, validator_type, session_id, verdict) VALUES (?, ?, ?, ?, ?, ?)",
      ['vv1', 'ms1', 'vc1', 'validator_scrutiny', 's1', 'pass']
    );
    const verdicts = repo.getVerdicts('ms1');
    expect(verdicts.length).toBe(1);
    expect(verdicts[0].verdict).toBe('pass');
  });

  it('classifies a verdict', () => {
    repo.classifyVerdict('vv1', 'blocking');
    const verdicts = repo.getVerdicts('ms1');
    expect(verdicts[0].classification).toBe('blocking');
  });

  it('inserts and retrieves a broadcast', () => {
    sqlRun(
      "INSERT INTO broadcasts (id, mission_id, author_id, author_type, category, title, content, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ['b1', 'm1', 'worker-1', 'worker', 'info', 'Update', 'All good', 'active']
    );
    const broadcasts = repo.getBroadcasts('m1');
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0].title).toBe('Update');
  });

  it('transitions a broadcast status', () => {
    repo.transitionBroadcast('b1', 'archived');
    const broadcasts = repo.getBroadcasts('m1');
    expect(broadcasts[0].status).toBe('archived');
  });

  it('inserts and retrieves a research finding', () => {
    sqlRun(
      "INSERT INTO research_findings (id, mission_id, author_id, title, content, status) VALUES (?, ?, ?, ?, ?, ?)",
      ['f1', 'm1', 'worker-1', 'Discovery', 'Found X', 'unverified']
    );
    const findings = repo.getFindings('m1');
    expect(findings.length).toBe(1);
    expect(findings[0].title).toBe('Discovery');
  });

  it('transitions a finding status', () => {
    repo.transitionFinding('f1', 'verified');
    const findings = repo.getFindings('m1');
    expect(findings[0].status).toBe('verified');
  });

  it('inserts and retrieves an agent session', () => {
    sqlRun(
      "INSERT INTO agent_sessions (session_id, agent_type, mission_id, milestone_id) VALUES (?, ?, ?, ?)",
      ['s1', 'worker', 'm1', 'ms1']
    );
    const sessions = repo.getSessionsForMilestone('ms1');
    expect(sessions.length).toBe(1);
    expect(sessions[0].agent_type).toBe('worker');
  });

  it('inserts a cost entry and summarizes costs', () => {
    sqlRun(
      "INSERT INTO cost_entries (id, mission_id, agent_session_id, model, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['c1', 'm1', 's1', 'gpt-4', 100, 50, 0.15]
    );
    const summary = repo.getMissionCost('m1');
    expect(summary.totalCost).toBe(0.15);
    expect(summary.totalTokens).toBe(150);
    expect(summary.entries).toBe(1);
  });

  it('increments retry counter on a milestone', () => {
    const result = repo.incrementRetry('ms1');
    expect(result.retries).toBe(1);
    const result2 = repo.incrementRetry('ms1');
    expect(result2.retries).toBe(2);
  });

  it('logs a rescope event', () => {
    repo.logRescope('ms1', { contractId: 'vc1', reason: 'scope changed', previousScope: 'old', newScope: 'new' });
    const rows = sqlJson('SELECT * FROM rescope_events WHERE milestone_id = ?', ['ms1']);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some(r => r.reason === 'scope changed')).toBe(true);
  });
});

const http = require('http');

describe('HTTP server framework', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { createHttpServer } = require('../src/http/server');
    server = createHttpServer({ repositories: { aurex: createAurexRepository({ sqlJson, sqlRun }) } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  function request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json' } };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  it('GET /health returns ok', async () => {
    const res = await request('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: true });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request('GET', '/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await new Promise((resolve, reject) => {
      const url = new URL('/missions', baseUrl);
      const opts = { method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'Content-Type': 'application/json' } };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.write('{invalid json');
      req.end();
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });
});

describe('HTTP server E2E — Aurex endpoints', () => {
  let server;
  let baseUrl;
  let req;

  beforeAll(async () => {
    const { createHttpServer } = require('../src/http/server');
    const aurex = createAurexRepository({ sqlJson, sqlRun });
    server = createHttpServer({ repositories: { aurex }, sqlJson, sqlRun });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    req = (method, path, body) => new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json' } };
      const httpReq = http.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      httpReq.on('error', reject);
      if (body) httpReq.write(JSON.stringify(body));
      httpReq.end();
    });
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  let missionId;
  let milestoneId;
  let unitId;
  let contractId;

  it('creates a mission', async () => {
    const res = await req('POST', '/missions', { description: 'E2E mission', config: { modelHints: {} } });
    expect(res.status).toBe(201);
    expect(res.body.description).toBe('E2E mission');
    expect(res.body.id).toBeDefined();
    missionId = res.body.id;
  });

  it('gets the mission', async () => {
    const res = await req('GET', `/missions/${missionId}`);
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('E2E mission');
  });

  it('updates mission status', async () => {
    const res = await req('PATCH', `/missions/${missionId}/status`, { status: 'running' });
    expect(res.status).toBe(200);
    const updated = await req('GET', `/missions/${missionId}`);
    expect(updated.body.status).toBe('running');
  });

  it('creates a milestone', async () => {
    const res = await req('POST', `/missions/${missionId}/milestones`, { title: 'Phase 1', description: 'Setup', orderIndex: 0 });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Phase 1');
    milestoneId = res.body.id;
  });

  it('updates milestone status', async () => {
    const res = await req('PATCH', `/milestones/${milestoneId}/status`, { status: 'in_progress' });
    expect(res.status).toBe(200);
  });

  it('creates a working unit', async () => {
    const res = await req('POST', `/milestones/${milestoneId}/units`, { description: 'Implement feature', declaredPaths: ['src/feature.js'], declaredModules: [] });
    expect(res.status).toBe(201);
    expect(res.body.description).toBe('Implement feature');
    unitId = res.body.id;
  });

  it('updates working unit status', async () => {
    const res = await req('PATCH', `/units/${unitId}/status`, { status: 'working' });
    expect(res.status).toBe(200);
  });

  it('writes a handoff', async () => {
    const res = await req('POST', `/units/${unitId}/handoff`, {
      featureName: 'Test feature',
      description: 'Implemented X',
      implemented: 'src/feature.js',
      remaining: 'Tests',
      rationale: 'Needed for Y',
      assumptions: 'Z is stable',
      unresolvedUncertainties: 'None',
      errorsEncountered: 'None',
      commandsRun: [{ command: 'npm test', exitCode: 0 }],
      gitCommitHash: 'abc123',
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
  });

  it('creates a contract', async () => {
    const res = await req('POST', `/milestones/${milestoneId}/contracts`, {
      content: { criteria: ['test passes'], testCommands: ['npm test'], acceptanceBehavior: 'All green' },
    });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
    contractId = res.body.id;
  });

  it('gets contract history', async () => {
    const res = await req('GET', `/milestones/${milestoneId}/contracts`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('writes a verdict', async () => {
    const res = await req('POST', '/verdicts', {
      sessionId: 's-e2e',
      milestoneId,
      contractId,
      validatorType: 'validator_scrutiny',
      verdict: 'pass',
      findings: 'All criteria met',
      failedUnitIds: [],
    });
    expect(res.status).toBe(201);
    expect(res.body.verdict).toBe('pass');
  });

  it('gets verdicts for milestone', async () => {
    const res = await req('GET', `/milestones/${milestoneId}/verdicts`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('writes a broadcast', async () => {
    const res = await req('POST', '/broadcasts', {
      agentId: 'worker-1',
      missionId,
      authorType: 'worker',
      category: 'info',
      title: 'Progress update',
      content: 'Phase 1 complete',
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Progress update');
  });

  it('gets broadcasts for mission', async () => {
    const res = await req('GET', `/missions/${missionId}/broadcasts`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('writes a research finding', async () => {
    const res = await req('POST', '/findings', {
      agentId: 'worker-1',
      missionId,
      domain: ['testing'],
      title: 'Test pattern',
      content: 'Found useful pattern',
      relevance: 'high',
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test pattern');
  });

  it('gets findings for mission', async () => {
    const res = await req('GET', `/missions/${missionId}/findings`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('registers an agent session', async () => {
    const res = await req('POST', '/sessions', {
      agentType: 'worker',
      sessionId: 's-e2e',
      missionId,
      milestoneId,
      unitId,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('gets sessions for milestone', async () => {
    const res = await req('GET', `/milestones/${milestoneId}/sessions`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('logs a cost entry', async () => {
    const res = await req('POST', '/costs', {
      missionId,
      agentSessionId: 's-e2e',
      model: 'gpt-4',
      promptTokens: 100,
      completionTokens: 50,
      cost: 0.15,
      timestamp: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('gets mission costs', async () => {
    const res = await req('GET', `/missions/${missionId}/costs`);
    expect(res.status).toBe(200);
    expect(res.body.totalCost).toBe(0.15);
    expect(res.body.entries).toBe(1);
  });

  it('increments retry', async () => {
    const res = await req('POST', `/milestones/${milestoneId}/retry`, {});
    expect(res.status).toBe(200);
    expect(res.body.retries).toBeGreaterThanOrEqual(1);
  });

  it('logs rescope', async () => {
    const res = await req('POST', `/milestones/${milestoneId}/rescope`, {
      contractId,
      reason: 'Scope expanded',
      previousScope: 'old scope',
      newScope: 'new scope',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('runs compression (stub)', async () => {
    const res = await req('POST', `/missions/${missionId}/compression`, { trigger: 'post_milestone' });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.skipped).toBe(true);
  });

  it('searches memory', async () => {
    const res = await req('POST', '/memory/search', { query: 'test', limit: 5 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /health still works after all operations', async () => {
    const res = await req('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
});
