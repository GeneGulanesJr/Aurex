/**
 * Git-analysis.js — Git commit frequency analysis for churn metrics
 *
 * Uses git CLI (zero native deps). Gracefully degrades if git unavailable.
 */

const { execSync } = require('child_process');
const path = require('path');

// Guard: reject calls when db handle is not available (CLI fallback mode)
function _requireNativeDb(db) {
  if (!db || typeof db.prepare !== 'function') {
    return {
      error:
        'This operation requires a native SQLite backend (node:sqlite or better-sqlite3). The CLI fallback does not support churn analysis.',
    };
  }
  return null;
}

function isGitAvailable() {
  try {
    execSync('git --version', { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function lookupRepo(db, repoId) {
  return db.prepare('SELECT id, path, name FROM code_repos WHERE id = ?').get(repoId);
}

function getCachedChurn(db, repoId, filePath, days) {
  return db
    .prepare('SELECT * FROM churn_metrics WHERE repo_id = ? AND file_path = ? AND window_days = ?')
    .get(repoId, filePath || '__all__', days);
}

function computeSince(days) {
  return new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
}

function resolveTarget(repoId, target, db) {
  const repo = lookupRepo(db, repoId);
  if (!repo) { return { error: `Repo ID ${repoId} not found` }; }
  const filePath = target && target !== '__all__' ? target : null;
  return { repo, filePath };
}

// eslint-disable-next-line max-statements -- churn computation inherently requires many steps
function getChurn(db, repoId, target, days, refresh) {
  const guard = _requireNativeDb(db);
  if (guard) { return guard; }

  const resolved = resolveTarget(repoId, target, db);
  if (resolved.error) { return resolved; }

  days = days || 90;
  refresh = refresh || false;

  if (!refresh) {
    const cached = getCachedChurn(db, repoId, resolved.filePath, days);
    if (cached) { return cached; }
  }

  const since = computeSince(days);
  if (resolved.filePath) {
    return computeFileChurn(db, resolved.repo, resolved.filePath, days, since);
  }
  return computeRepoChurn(db, resolved.repo, days, since);
}

function getFirstSeen(repoPath, filePath) {
  try {
    const fullLog = execSync(`git -C "${repoPath}" log --follow --format="%aI" -- "${filePath}"`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const allDates = fullLog.split('\n').filter(Boolean).sort();
    return allDates.length ? allDates[0] : null;
  } catch {
    return null;
  }
}

function parseCommitLog(log) {
  const lines = log.split('\n');
  const authors = new Set(lines.map((l) => l.split('|')[1]).filter(Boolean));
  const dates = lines.map((l) => l.split('|')[2]).filter(Boolean).sort();
  return { lines, authors, dates };
}

function buildFileChurnResult(lines, authors, dates, firstSeen, days) {
  return {
    commits: lines.length,
    unique_authors: authors.size,
    first_seen: firstSeen,
    last_modified: dates[dates.length - 1] || null,
    churn_per_week: Math.round((lines.length / (days / 7)) * 100) / 100,
  };
}

// eslint-disable-next-line max-statements -- file churn computation requires many steps
function computeFileChurn(db, repo, filePath, days, since) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(repo.path, filePath);
  try {
    const log = execSync(
      `git -C "${repo.path}" log --follow --format="%H|%an|%aI" --since="${since}" -- "${filePath}"`,
      { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (!log) {
      const result = { commits: 0, unique_authors: 0, churn_per_week: 0, first_seen: null, last_modified: null };
      upsertChurn(db, repo.id, absPath, days, result);
      return result;
    }

    const { lines, authors, dates } = parseCommitLog(log);
    const firstSeen = getFirstSeen(repo.path, filePath) || dates[0];
    const result = buildFileChurnResult(lines, authors, dates, firstSeen, days);
    upsertChurn(db, repo.id, absPath, days, result);
    return result;
  } catch (e) {
    return { error: `git log failed: ${e.message}` };
  }
}

function computeRepoChurn(db, repo, days, since) {
  try {
    const log = execSync(`git -C "${repo.path}" log --since="${since}" --format="" --name-only`, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const fileCounts = new Map();
    for (const line of log.split('\n')) {
      const f = line.trim();
      if (f) { fileCounts.set(f, (fileCounts.get(f) || 0) + 1); }
    }

    const topFiles = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([file, commits]) => ({
        file,
        commits,
        churn_per_week: Math.round((commits / (days / 7)) * 100) / 100,
      }));

    return { repo: repo.name, window_days: days, total_files_changed: fileCounts.size, top_files: topFiles };
  } catch (e) {
    return { error: `git log failed: ${e.message}` };
  }
}

function upsertChurn(db, repoId, filePath, windowDays, metrics) {
  db.prepare(`
    INSERT OR REPLACE INTO churn_metrics (repo_id, file_path, commits, unique_authors, first_seen, last_modified, churn_per_week, window_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    repoId,
    filePath,
    metrics.commits,
    metrics.unique_authors,
    metrics.first_seen,
    metrics.last_modified,
    metrics.churn_per_week,
    windowDays,
  );
}

module.exports = { getChurn, isGitAvailable };
