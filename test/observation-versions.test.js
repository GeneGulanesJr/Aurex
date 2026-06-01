const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');

describe('observation_versions table', () => {
  let deps;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-observation-versions-'));
    db.resetDb();
    db.createDb({ db_path: path.join(tempDir, 'memory.db') });
    deps = {
      sqlJson: db.sqlJson,
      sqlRun: db.sqlRun,
    };
  });

  afterEach(() => {
    db.resetDb();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates observation_versions table after migration', () => {
    const tables = deps.sqlJson(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='observation_versions'",
    );
    expect(tables).toHaveLength(1);
  });

  it('can insert and query a version record', () => {
    deps.sqlRun(
      `INSERT INTO observations (id, session_id, type, title, content, project, scope)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [1, '1', 'decision', 'Memory 1', 'content', 'test', 'project'],
    );
    deps.sqlRun(
      "INSERT INTO observation_versions (memory_id, field, old_value, new_value) VALUES (1, 'content', 'old text', 'new text')",
    );
    const rows = deps.sqlJson('SELECT * FROM observation_versions WHERE memory_id = 1');
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('content');
    expect(rows[0].old_value).toBe('old text');
    expect(rows[0].new_value).toBe('new text');
  });
});
