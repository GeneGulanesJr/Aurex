const dbModule = require('../db');
const wfDA = require('../data-access/workflows');

describe('data-access/workflows', () => {
  beforeAll(() => {
    dbModule.ensureDb();
  });

  describe('saveWorkflow', () => {
    it('should require id and name', () => {
      const deps = { sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.saveWorkflow(deps, { id: null, name: null, project: null, stepsRaw: null });
      expect(result.error).toContain('Missing');
    });

    it('should save workflow without steps', () => {
      const deps = { sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.saveWorkflow(deps, { id: 'wf-1', name: 'Test Workflow', project: null, stepsRaw: null });
      expect(result.ok).toBe(true);
      expect(result.stepsSaved).toBe(0);
    });

    it('should save workflow with steps', () => {
      const deps = { sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const steps = 'step1\\nstep2\\nstep3';
      const result = wfDA.saveWorkflow(deps, { id: 'wf-2', name: 'Steps Workflow', project: null, stepsRaw: steps });
      expect(result.ok).toBe(true);
      expect(result.stepsSaved).toBe(3);
      expect(deps.sqlRun).toHaveBeenCalled();
    });
  });

  describe('recordStep', () => {
    it('should require workflow, step, and command', () => {
      const deps = { sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.recordStep(deps, { workflow: null, step: null, command: null });
      expect(result.error).toContain('Missing');
    });

    it('should record a step successfully', () => {
      const deps = { sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.recordStep(deps, { workflow: 'wf-1', step: 1, command: 'search test' });
      expect(result.ok).toBe(true);
      expect(deps.sqlRun).toHaveBeenCalledWith(
        expect.stringContaining('procedural_steps'),
        expect.arrayContaining(['wf-1', 1, 'search test']),
      );
    });
  });

  describe('stepOutcome', () => {
    it('should require workflow and step', () => {
      const deps = { sqlJson: vi.fn(), sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.stepOutcome(deps, { workflow: null, step: null });
      expect(result.error).toContain('Missing');
    });

    it('should update success', () => {
      const sqlJson = vi.fn(() => [{ success: 1.0, attempts: 2, fail_workaround: null }]);
      const deps = { sqlJson, sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.stepOutcome(deps, { workflow: 'wf-1', step: 1, success: true });
      expect(result.ok).toBe(true);
      expect(result.success).toBe(1.0);
    });

    it('should update failure with workaround', () => {
      const sqlJson = vi.fn(() => [{ success: 0.5, attempts: 2, fail_workaround: 'try different approach' }]);
      const deps = { sqlJson, sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.stepOutcome(deps, {
        workflow: 'wf-1',
        step: 1,
        success: false,
        workaround: 'try different approach',
      });
      expect(result.ok).toBe(true);
      expect(result.fail_workaround).toBe('try different approach');
    });

    it('should return ok when step row not found', () => {
      const sqlJson = vi.fn(() => []);
      const deps = { sqlJson, sqlRun: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.stepOutcome(deps, { workflow: 'wf-1', step: 1, success: true });
      expect(result.ok).toBe(true);
    });
  });

  describe('getWorkflow', () => {
    it('should require id', () => {
      const deps = { sqlJson: vi.fn(), jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.getWorkflow(deps, { id: null });
      expect(result.error).toContain('Missing');
    });

    it('should return error for non-existent workflow', () => {
      const sqlJson = vi.fn(() => []);
      const deps = { sqlJson, jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.getWorkflow(deps, { id: 'nonexistent' });
      expect(result.error).toContain('not found');
    });

    it('should return workflow with steps', () => {
      const sqlJson = vi.fn((query, params) => {
        if (query.includes('procedural_memory')) {
          return [{ id: 'wf-1', name: 'Test', project: 'proj', status: 'active' }];
        }
        if (query.includes('procedural_steps')) {
          return [{ step_num: 1, command: 'search', success: 1.0 }];
        }
        return [];
      });
      const deps = { sqlJson, jsonErrNoExit: vi.fn((msg) => ({ error: msg })) };
      const result = wfDA.getWorkflow(deps, { id: 'wf-1' });
      expect(result.id).toBe('wf-1');
      expect(result.steps.length).toBe(1);
    });
  });
});
