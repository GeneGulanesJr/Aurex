const { createDb, resetDb, sqlJson, sqlRun } = require('../db');

describe('Aurex DB schema migration', () => {
  beforeAll(() => {
    resetDb();
    createDb({ db_path: ':memory:' });
  });
  afterAll(() => resetDb());

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
