const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const { insertRecallLog, getRecallCount, recallScore } = require('../src/memory-domain/recall');
const { insertRecallLog: insertRecallLogDA } = require('../data-access/observations');

describe('recall feedback', () => {
  let deps;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-recall-feedback-'));
    db.resetDb();
    db.createDb({ db_path: path.join(tempDir, 'memory.db') });
    deps = {
      sqlJson: db.sqlJson,
      sqlRun: db.sqlRun,
    };
    for (const id of [1, 2, 3, 10, 11, 20, 42]) {
      deps.sqlRun(
        `INSERT INTO observations (id, session_id, type, title, content, project, scope)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, '1', 'decision', `Memory ${id}`, 'content', 'test', 'project'],
      );
    }
  });

  afterEach(() => {
    db.resetDb();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('inserts recall log with was_useful=true', () => {
    const result = insertRecallLog(deps, [
      { memoryId: 1, sessionId: 1, query: 'test', wasUseful: true },
    ]);
    expect(result.inserted).toBe(1);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 1');
    expect(rows[0].was_useful).toBe(1);
  });

  it('inserts recall log with was_useful=false', () => {
    const result = insertRecallLog(deps, [
      { memoryId: 2, sessionId: 1, query: 'test', wasUseful: false },
    ]);
    expect(result.inserted).toBe(1);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 2');
    expect(rows[0].was_useful).toBe(0);
  });

  it('defaults was_useful to 1 (positive recall) when not specified', () => {
    insertRecallLog(deps, [
      { memoryId: 3, sessionId: 1, query: 'test' },
    ]);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 3');
    expect(rows[0].was_useful).toBe(1);
  });

  it('handles mixed batch of useful and not-useful', () => {
    insertRecallLog(deps, [
      { memoryId: 10, sessionId: 1, query: 'q1', wasUseful: true },
      { memoryId: 11, sessionId: 1, query: 'q1', wasUseful: false },
    ]);
    const rows = deps.sqlJson('SELECT memory_id, was_useful FROM recall_log ORDER BY memory_id');
    expect(rows).toHaveLength(2);
    expect(rows[0].was_useful).toBe(1);
    expect(rows[1].was_useful).toBe(0);
  });

  it('data-access insertRecallLog also writes was_useful (CLI path)', () => {
    insertRecallLogDA(deps, [
      { memoryId: 20, sessionId: 1, query: 'test', wasUseful: false },
    ]);
    const rows = deps.sqlJson('SELECT was_useful FROM recall_log WHERE memory_id = 20');
    expect(rows[0].was_useful).toBe(0);
  });
});
