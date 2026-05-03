// Tests for git-analysis.js — churn and provenance
const gitAnalysis = require('../git-analysis');

describe('git-analysis.js', () => {
  describe('isGitAvailable', () => {
    it('should detect git in this environment', () => {
      // We're running inside a git repo — git must be available
      expect(gitAnalysis.isGitAvailable()).toBe(true);
    });
  });

  describe('getChurn', () => {
    it('should reject missing db handle', () => {
      const result = gitAnalysis.getChurn(null, 1, '__all__', 90, false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getProvenance', () => {
    it('should reject missing db handle', () => {
      const result = gitAnalysis.getProvenance(null, 1, 'someSymbol');
      expect(result.error).toBeDefined();
    });

    // Full provenance test requires an indexed repo — tested in integration tests
  });

  describe('classifyCommit', () => {
    it('should classify creation commits', () => {
      expect(gitAnalysis.classifyCommit('Initial commit')).toBe('creation');
      expect(gitAnalysis.classifyCommit('first commit of project')).toBe('creation');
    });

    it('should classify feature commits', () => {
      expect(gitAnalysis.classifyCommit('Add user authentication')).toBe('feature');
      expect(gitAnalysis.classifyCommit('Implement search endpoint')).toBe('feature');
      expect(gitAnalysis.classifyCommit('Create settings page')).toBe('feature');
    });

    it('should classify bugfix commits', () => {
      expect(gitAnalysis.classifyCommit('Fix null pointer in parser')).toBe('bugfix');
      expect(gitAnalysis.classifyCommit('Hotfix: memory leak in cache')).toBe('bugfix');
      expect(gitAnalysis.classifyCommit('Patch session timeout bug')).toBe('bugfix');
    });

    it('should classify refactor commits', () => {
      expect(gitAnalysis.classifyCommit('Refactor database layer')).toBe('refactor');
      expect(gitAnalysis.classifyCommit('Clean up unused imports')).toBe('refactor');
      expect(gitAnalysis.classifyCommit('Reorganize test files')).toBe('refactor');
    });

    it('should classify performance commits', () => {
      expect(gitAnalysis.classifyCommit('Optimize query performance')).toBe('perf');
      expect(gitAnalysis.classifyCommit('Speed up startup time')).toBe('perf');
    });

    it('should classify rename commits', () => {
      expect(gitAnalysis.classifyCommit('Rename config to settings')).toBe('rename');
      expect(gitAnalysis.classifyCommit('Move utils to shared module')).toBe('rename');
      expect(gitAnalysis.classifyCommit('Relocate auth middleware')).toBe('rename');
    });

    it('should classify revert commits', () => {
      expect(gitAnalysis.classifyCommit('Revert "Add feature X"')).toBe('revert');
      expect(gitAnalysis.classifyCommit('Rollback deployment config')).toBe('revert');
    });

    it('should return unknown for unrecognized messages', () => {
      expect(gitAnalysis.classifyCommit('Various changes')).toBe('unknown');
      expect(gitAnalysis.classifyCommit('WIP')).toBe('unknown');
      expect(gitAnalysis.classifyCommit('')).toBe('unknown');
    });

    it('should handle multi-word detection correctly', () => {
      // 'fix' in 'prefix' should not trigger bugfix
      expect(gitAnalysis.classifyCommit('Update prefix handling')).toBe('unknown');
      // 'perf' inside another word should not trigger
      expect(gitAnalysis.classifyCommit('Superficial change')).toBe('unknown');
    });
  });
});
