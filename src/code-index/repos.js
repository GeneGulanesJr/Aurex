async function first(rows) {
  return rows && rows.length > 0 ? rows[0] : null;
}

function createCodeIndexRepository(deps) {
  const { sqlJson, sqlRun } = deps;

  return Object.freeze({
    async findRepoByName(name) {
      return first(await sqlJson('SELECT * FROM code_repos WHERE name = ? LIMIT 1', [name]));
    },
    async findRepoByPath(repoPath) {
      return first(await sqlJson('SELECT * FROM code_repos WHERE path = ? LIMIT 1', [repoPath]));
    },
    async createRepo({ name, path }) {
      await sqlRun('INSERT INTO code_repos (name, path) VALUES (?, ?)', [name, path]);
      return (await this.findRepoByName(name)).id;
    },
    async updateRepoPath(repoId, repoPath) {
      await sqlRun("UPDATE code_repos SET path = ?, updated_at = datetime('now') WHERE id = ?", [repoPath, repoId]);
    },
    async updateRepoName(repoId, name) {
      await sqlRun("UPDATE code_repos SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, repoId]);
    },
    async upsertRepo({ name, path }) {
      const byName = await this.findRepoByName(name);
      if (byName) {
        await this.updateRepoPath(byName.id, path);
        return byName.id;
      }
      const byPath = await this.findRepoByPath(path);
      if (byPath) {
        await this.updateRepoName(byPath.id, name);
        return byPath.id;
      }
      return await this.createRepo({ name, path });
    },
    async clearRepoIndex(repoId) {
      await sqlRun('DELETE FROM code_symbols WHERE repo_id = ?', [repoId]);
      await sqlRun('DELETE FROM code_files WHERE repo_id = ?', [repoId]);
      await sqlRun('DELETE FROM churn_metrics WHERE repo_id = ?', [repoId]);
    },
    async listFiles(repoId) {
      return await sqlJson('SELECT * FROM code_files WHERE repo_id = ?', [repoId]);
    },
    async insertFile(params) {
      await sqlRun(
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
      return await sqlJson('SELECT id FROM code_files WHERE repo_id = ? AND path = ?', [params.repoId, params.path])[0]
        .id;
    },
    async updateFile(fileId, params) {
      await sqlRun(
        'UPDATE code_files SET content = ?, content_hash = ?, mtime = ?, size_bytes = ?, line_count = ?, language = ? WHERE id = ?',
        [params.content, params.contentHash, params.mtime, params.sizeBytes, params.lineCount, params.language, fileId],
      );
    },
    async deleteFile(fileId) {
      await sqlRun('DELETE FROM code_symbols WHERE file_id = ?', [fileId]);
      await sqlRun('DELETE FROM code_files WHERE id = ?', [fileId]);
    },
    async clearFileSymbols(fileId) {
      await sqlRun('DELETE FROM code_symbols WHERE file_id = ?', [fileId]);
    },
    async insertSymbol(params) {
      await sqlRun(
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
    async updateRepoStats({ repoId, headCommit }) {
      await sqlRun(
        "UPDATE code_repos SET file_count = (SELECT count(*) FROM code_files WHERE repo_id = ?), symbol_count = (SELECT count(*) FROM code_symbols WHERE repo_id = ?), head_commit = COALESCE(?, head_commit), updated_at = datetime('now') WHERE id = ?",
        [repoId, repoId, headCommit || null, repoId],
      );
    },
    async listRepos() {
      return await sqlJson(
        'SELECT name, path, file_count, symbol_count, indexed_at, updated_at FROM code_repos ORDER BY updated_at DESC',
      );
    },
    async removeRepoByName(name) {
      const repo = await this.findRepoByName(name);
      if (!repo) {
        return false;
      }
      await sqlRun('DELETE FROM code_repos WHERE id = ?', [repo.id]);
      return true;
    },
    async findSymbolSource({ repoName, filePath, symbolName }) {
      return (
        (
          await sqlJson(
            `SELECT s.*, f.content
         FROM code_symbols s
         JOIN code_files f ON f.id = s.file_id
         JOIN code_repos r ON r.id = s.repo_id
         WHERE r.name = ? AND s.file_path = ? AND s.name = ?
         LIMIT 1`,
            [repoName, filePath, symbolName],
          )
        )[0] || null
      );
    },
  });
}

module.exports = { createCodeIndexRepository };
