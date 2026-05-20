import { isRepoStale, invalidateRepoCache } from '../extensions/memory-layer/host/project-detector.ts';
import { state } from '../extensions/memory-layer/state.ts';

describe('repo-cache', () => {
  describe('isRepoStale', () => {
    it('should return false for recently indexed repo', () => {
      const repo = {
        name: 'test',
        path: '/nonexistent/path/that/will/not/stat',
        indexed_at: new Date().toISOString(),
        file_count: 10,
        symbol_count: 50,
      };
      expect(isRepoStale(repo)).toBe(false);
    });

    it('should return false when path does not exist', () => {
      const repo = {
        name: 'test',
        path: '/nonexistent/path',
        indexed_at: new Date().toISOString(),
        file_count: 0,
        symbol_count: 0,
      };
      expect(isRepoStale(repo)).toBe(false);
    });
  });

  describe('invalidateRepoCache', () => {
    it('should clear cached repos and reset cache time', () => {
      state.cachedRepos = [{ name: 'test', path: '/test', indexed_at: '2025-01-01', file_count: 1, symbol_count: 1 }];
      state.repoCacheTime = Date.now();

      invalidateRepoCache();

      expect(state.cachedRepos).toBeNull();
      expect(state.repoCacheTime).toBe(0);
    });
  });
});
