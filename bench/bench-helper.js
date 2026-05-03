/**
 * bench-helper.js — Shared utilities for token efficiency benchmarks
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ══════════════════════════════════════════════════════════
// BENCHMARK MATRIX
// ══════════════════════════════════════════════════════════

const BENCHMARK_TOOLS = [
  { name: 'importance', cli: 'importance', toolName: 'getSymbolImportance' },
  { name: 'hotspots', cli: 'hotspots', toolName: 'getHotspots' },
  { name: 'dead-code', cli: 'dead-code', toolName: 'getDeadCode' },
  { name: 'coupling', cli: 'coupling', toolName: 'getCouplingMetrics' },
  { name: 'extraction', cli: 'extractable', toolName: 'getExtractionCandidates' },
  { name: 'call-hierarchy', cli: 'call-hierarchy', toolName: 'getCallHierarchy' },
  { name: 'cycles', cli: 'cycles', toolName: 'getDependencyCycles' },
  { name: 'blast-radius', cli: 'blast-radius', toolName: 'getBlastRadius' },
];

// ══════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════

/**
 * Estimate token count from byte size (4 chars ≈ 1 token heuristic).
 */
function estimateTokens(bytesOrObj) {
  const str = typeof bytesOrObj === 'string' ? bytesOrObj : JSON.stringify(bytesOrObj);
  return Math.ceil(str.length / 3.5);
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Format percentage.
 */
function pct(savings) {
  const sign = savings >= 0 ? '-' : '+';
  return `${sign}${Math.abs(Math.round(savings * 100))}%`;
}

/**
 * Pad string to width.
 */
function pad(str, width) {
  return String(str).padEnd(width);
}

/**
 * Run a CLI command against memory-store.js and return parsed JSON.
 */
function runCli(repo, subcommand, extraFlags = '') {
  const cmd = `node memory-store.js ${subcommand} --repo ${repo} ${extraFlags}`;
  try {
    const stdout = execSync(cmd, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();
    return JSON.parse(stdout);
  } catch (e) {
    return { error: e.message, stderr: e.stderr?.toString() };
  }
}

/**
 * Check if a repo is already indexed.
 */
function isRepoIndexed(repo) {
  try {
    const stdout = execSync('node memory-store.js list-code-repos', {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const data = JSON.parse(stdout);
    return (data.repos || []).some(r => r.name === repo);
  } catch (_) {
    return false;
  }
}

/**
 * Find a symbol with callers for call-hierarchy/blast-radius benchmarks.
 */
function findSymbolWithCallers(repo) {
  try {
    const stdout = execSync(`node memory-store.js hotspots --repo ${repo} --top 1`, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    const data = JSON.parse(stdout);
    const files = data.files || [];
    if (files.length === 0) return null;
    // Get symbols from the hottest file
    const hotFile = files[0].file_path;
    const outlineOut = execSync(`node memory-store.js outline --repo ${repo} --file "${hotFile}"`, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    const outline = JSON.parse(outlineOut);
    const syms = outline.symbols || [];
    // Find a function with non-trivial name
    return syms.find(s => s.kind === 'function' && s.name.length > 3)?.name || syms[0]?.name || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  BENCHMARK_TOOLS,
  estimateTokens,
  formatBytes,
  pct,
  pad,
  runCli,
  isRepoIndexed,
  findSymbolWithCallers,
};
