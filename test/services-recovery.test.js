const { autoRecover, recoverOrphans } = require('../services/recovery');

describe('services/recovery', () => {
  describe('autoRecover', () => {
    it('should require session parameter', () => {
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const result = autoRecover({ jsonErrNoExit }, {});
      expect(result.error).toContain('session');
    });

    it('should return nothing_to_recover when session has no observations', () => {
      const jsonErrNoExit = vi.fn((msg) => ({ error: msg }));
      const sqlJson = vi.fn((query, params) => {
        if (query.includes('session_log')) {
          return [{ id: 1, project: 'test', started_at: '2025-01-01' }];
        }
        return [];
      });
      const sqlRun = vi.fn();
      const result = autoRecover({ jsonErrNoExit, sqlJson, sqlRun }, { session: '1' });
      expect(result.status).toBe('nothing_to_recover');
    });
  });

  describe('recoverOrphans', () => {
    it('should return empty when no orphan sessions', () => {
      const sqlJson = vi.fn(() => []);
      const softDeleteObservation = vi.fn();
      const result = recoverOrphans({ sqlJson, sqlRun: vi.fn(), softDeleteObservation });
      expect(result.recovered).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should recover orphan sessions', () => {
      let callCount = 0;
      const sqlJson = vi.fn((query, params) => {
        callCount++;
        if (query.includes('ended_at IS NULL')) {
          return [{ id: 5, project: 'test-proj' }];
        }
        if (query.includes("type NOT IN ('skill'")) {
          return [{ id: 100, title: 'Important', type: 'decision', content: 'Stuff', created_at: '2025-01-01' }];
        }
        if (query.includes('session_log')) {
          return [{ id: 5, project: 'test-proj', started_at: '2025-01-01' }];
        }
        if (query.includes('RETURNING id')) {
          return [{ id: 999 }];
        }
        return [];
      });
      const sqlRun = vi.fn();
      const softDeleteObservation = vi.fn();
      const result = recoverOrphans({ sqlJson, sqlRun, softDeleteObservation });
      expect(result.total).toBe(1);
    });
  });
});
