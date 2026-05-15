function createCodeIndexRepository(deps) {
  const { sqlJson, sqlRun } = deps;
  const findRepoByName = (name) => sqlJson('SELECT * FROM code_repos WHERE name = ? LIMIT 1', [name]);
  return Object.freeze({
    findRepoByName,
    findRepoByPath(path) {
      return sqlJson('SELECT * FROM code_repos WHERE path = ? LIMIT 1', [path]);
    },
    upsertRepoByName({ name, path }) {
      const existing = findRepoByName(name);
      if (existing.length > 0) {
        sqlRun("UPDATE code_repos SET path = ?, updated_at = datetime('now') WHERE id = ?", [path, existing[0].id]);
        return existing[0].id;
      }
      sqlRun('INSERT INTO code_repos (name, path) VALUES (?, ?)', [name, path]);
      return findRepoByName(name)[0].id;
    },
    clearRepoIndex(repoId) {
      sqlRun('DELETE FROM code_symbols WHERE repo_id = ?', [repoId]);
      sqlRun('DELETE FROM code_files WHERE repo_id = ?', [repoId]);
      sqlRun('DELETE FROM churn_metrics WHERE repo_id = ?', [repoId]);
    },
    insertFile(params) {
      sqlRun(
        'INSERT INTO code_files (repo_id, path, language, content, content_hash, mtime, size_bytes, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          params.repoId,
          params.path,
          params.language,
          params.content,
          params.contentHash,
          params.mtime,
          params.sizeBytes,
          params.lineCount,
        ],
      );
      return sqlJson('SELECT id FROM code_files WHERE repo_id = ? AND path = ?', [params.repoId, params.path])[0].id;
    },
    insertSymbol(params) {
      sqlRun(
        `INSERT INTO code_symbols (repo_id, file_id, file_path, name, kind, signature, qualified_name,
         start_line, end_line, start_byte, end_byte, docstring, body_preview, language, parent_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.repoId,
          params.fileId,
          params.filePath,
          params.name,
          params.kind,
          params.signature,
          params.qualifiedName,
          params.startLine,
          params.endLine,
          params.startByte,
          params.endByte,
          params.docstring || '',
          params.bodyPreview || '',
          params.language,
          params.parentName || '',
        ],
      );
    },
    updateRepoStats({ repoId, headCommit }) {
      sqlRun(
        "UPDATE code_repos SET file_count = (SELECT count(*) FROM code_files WHERE repo_id = ?), symbol_count = (SELECT count(*) FROM code_symbols WHERE repo_id = ?), head_commit = ?, updated_at = datetime('now') WHERE id = ?",
        [repoId, repoId, headCommit || null, repoId],
      );
    },
    listRepos() {
      return sqlJson('SELECT * FROM code_repos ORDER BY updated_at DESC');
    },
  });
}

module.exports = { createCodeIndexRepository };
