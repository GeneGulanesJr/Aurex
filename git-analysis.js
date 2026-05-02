/**
 * git-analysis.js — Git commit frequency analysis for churn metrics
 *
 * Uses git CLI (zero native deps). Gracefully degrades if git unavailable.
 */

const { execSync } = require('child_process');

function isGitAvailable() {
  try {
    execSync('git --version', { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

function getChurn(db, repoId, target, days, refresh) {
  days = days || 90;
  refresh = refresh || false;

  if (!isGitAvailable()) {
    return { error: 'git not available. Install git for churn metrics.' };
  }

  const repo = db.prepare('SELECT id, path, name FROM code_repos WHERE id = ?').get(repoId);
  if (!repo) return { error: `Repo ID ${repoId} not found` };

  const filePath = target && target !== '__all__' ? target : null;

  // Check cache
  if (!refresh) {
    const cached = db.prepare(
      'SELECT * FROM churn_metrics WHERE repo_id = ? AND file_path = ? AND window_days = ?'
    ).get(repoId, filePath || '__all__', days);
    if (cached) return cached;
  }

  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  if (filePath) {
    return computeFileChurn(db, repo, filePath, days, since);
  }
  return computeRepoChurn(db, repo, days, since);
}

function computeFileChurn(db, repo, filePath, days, since) {
  try {
    const log = execSync(
      `git -C "${repo.path}" log --follow --format="%H|%an|%aI" --since="${since}" -- "${filePath}"`,
      { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!log) {
      const result = { commits: 0, unique_authors: 0, churn_per_week: 0, first_seen: null, last_modified: null };
      upsertChurn(db, repo.id, filePath, days, result);
      return result;
    }

    const lines = log.split('\n');
    const authors = new Set(lines.map(l => l.split('|')[1]).filter(Boolean));
    const dates = lines.map(l => l.split('|')[2]).filter(Boolean).sort();

    let firstSeen = dates[0];
    try {
      const fullLog = execSync(
        `git -C "${repo.path}" log --follow --format="%aI" -- "${filePath}"`,
        { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      const allDates = fullLog.split('\n').filter(Boolean).sort();
      if (allDates.length) firstSeen = allDates[0];
    } catch (_) {}

    const result = {
      commits: lines.length,
      unique_authors: authors.size,
      first_seen: firstSeen,
      last_modified: dates[dates.length - 1] || null,
      churn_per_week: Math.round((lines.length / (days / 7)) * 100) / 100,
    };

    upsertChurn(db, repo.id, filePath, days, result);
    return result;
  } catch (e) {
    return { error: `git log failed: ${e.message}` };
  }
}

function computeRepoChurn(db, repo, days, since) {
  try {
    const log = execSync(
      `git -C "${repo.path}" log --since="${since}" --format="" --name-only`,
      { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const fileCounts = new Map();
    for (const line of log.split('\n')) {
      const f = line.trim();
      if (f) fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
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
    repoId, filePath, metrics.commits, metrics.unique_authors,
    metrics.first_seen, metrics.last_modified, metrics.churn_per_week, windowDays
  );
}

module.exports = { getChurn, isGitAvailable };
