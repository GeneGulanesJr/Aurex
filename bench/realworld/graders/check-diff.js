#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');

/**
 * Check that the diff in a worktree respects must_touch / must_not_touch constraints.
 * @param {object} task - Task definition with success.must_touch and success.must_not_touch
 * @param {string} worktreePath - Absolute path to the git worktree
 * @returns {{ passed: boolean, touched: string[], violations: string[], missed: string[] }}
 */
function checkDiff(task, worktreePath) {
  const mustTouch = task.success?.must_touch || [];
  const mustNotTouch = task.success?.must_not_touch || [];

  let rawDiff;
  try {
    rawDiff = execSync('git diff --name-only', {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
  } catch {
    rawDiff = '';
  }

  const touched = rawDiff ? rawDiff.split(/\r?\n/).filter(Boolean) : [];

  // Normalize paths for comparison (both forward-slash)
  const normalize = (p) => p.replace(/\\/g, '/');
  const touchedNorm = new Set(touched.map(normalize));

  const violations = mustNotTouch.filter((f) => touchedNorm.has(normalize(f)));
  const missed = mustTouch.filter((f) => !touchedNorm.has(normalize(f)));

  return {
    passed: violations.length === 0 && missed.length === 0,
    touched,
    violations,
    missed,
  };
}

if (require.main === module) {
  const taskPath = process.argv[2];
  const worktreePath = process.argv[3];
  if (!taskPath || !worktreePath) {
    console.error('Usage: node check-diff.js <task.json> <worktree-path>');
    process.exit(1);
  }
  const task = JSON.parse(require('fs').readFileSync(taskPath, 'utf-8'));
  const result = checkDiff(task, worktreePath);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { checkDiff };
