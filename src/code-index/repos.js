function first(rows) {
  return rows && rows.length > 0 ? rows[0] : null;
}

function createCodeIndexRepository(deps) {
  const { sqlJson, sqlRun, withTransaction: tx } = deps;

  function _withTransaction(fn) {
    if (tx) {
      return tx(fn);
    }
    const dbModule = require('../../db');
    if (dbModule.withTransaction) {
      return dbModule.withTransaction(fn);
    }
    return fn();
  }

  return Object.freeze({
    withTransaction(fn) {
      return _withTransaction(fn);
    },
    findRepoByName(name) {
      return first(sqlJson('SELECT * FROM code_repos WHERE name = ? LIMIT 1', [name]));
    },
    findRepoByPath(repoPath) {
      return first(sqlJson('SELECT * FROM code_repos WHERE path = ? LIMIT 1', [repoPath]));
    },
    createRepo({ name, path }) {
      sqlRun('INSERT INTO code_repos (name, path) VALUES (?, ?)', [name, path]);
      return this.findRepoByName(name).id;
    },
    updateRepoPath(repoId, repoPath) {
      sqlRun("UPDATE code_repos SET path = ?, updated_at = datetime('now') WHERE id = ?", [repoPath, repoId]);
    },
    updateRepoName(repoId, name) {
      sqlRun("UPDATE code_repos SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, repoId]);
    },
    upsertRepo({ name, path }) {
      const byName = this.findRepoByName(name);
      if (byName) {
        this.updateRepoPath(byName.id, path);
        return byName.id;
      }
      const byPath = this.findRepoByPath(path);
      if (byPath) {
        this.updateRepoName(byPath.id, name);
        return byPath.id;
      }
      return this.createRepo({ name, path });
    },
    clearRepoIndex(repoId, options = {}) {
      const batchSize = Math.max(1, Number(options.batchSize) || 1000);
      const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
      const emit = (message, extra = {}) => {
        if (onProgress) {
          onProgress({ message, ...extra });
        }
      };
      const deleteByIdBatch = ({ label, selectSql, selectParams = [] }) => {
        let deleted = 0;
        emit(`Clearing ${label.name}...`, { deleted });
        for (;;) {
          const rows = sqlJson(selectSql, [...selectParams, batchSize]);
          if (!rows.length) {
            break;
          }
          const ids = rows.map((row) => row.id);
          const placeholders = ids.map(() => '?').join(', ');
          sqlRun(`DELETE FROM ${label.table} WHERE id IN (${placeholders})`, ids);
          deleted += ids.length;
          emit(`Cleared ${deleted} ${label.name}`, { deleted });
          if (ids.length < batchSize) {
            break;
          }
        }
        return deleted;
      };

      const totals = {};
      _withTransaction(() => {
        totals.symbolComplexity = deleteByIdBatch({
          label: { table: 'symbol_complexity', name: 'complexity rows' },
          selectSql:
            'SELECT sc.id FROM symbol_complexity sc JOIN code_symbols s ON s.id = sc.symbol_id WHERE s.repo_id = ? LIMIT ?',
          selectParams: [repoId],
        });
        totals.calls = deleteByIdBatch({
          label: { table: 'code_calls', name: 'call edges' },
          selectSql: 'SELECT id FROM code_calls WHERE repo_id = ? LIMIT ?',
          selectParams: [repoId],
        });
        totals.imports = deleteByIdBatch({
          label: { table: 'code_imports', name: 'import edges' },
          selectSql: 'SELECT id FROM code_imports WHERE repo_id = ? LIMIT ?',
          selectParams: [repoId],
        });
        totals.churn = deleteByIdBatch({
          label: { table: 'churn_metrics', name: 'churn rows' },
          selectSql: 'SELECT id FROM churn_metrics WHERE repo_id = ? LIMIT ?',
          selectParams: [repoId],
        });
        totals.symbols = deleteByIdBatch({
          label: { table: 'code_symbols', name: 'symbols' },
          selectSql: 'SELECT id FROM code_symbols WHERE repo_id = ? LIMIT ?',
          selectParams: [repoId],
        });
        totals.files = deleteByIdBatch({
          label: { table: 'code_files', name: 'files' },
          selectSql: 'SELECT id FROM code_files WHERE repo_id = ? LIMIT ?',
          selectParams: [repoId],
        });
      });
      return totals;
    },
    listFiles(repoId) {
      return sqlJson('SELECT * FROM code_files WHERE repo_id = ?', [repoId]);
    },
    insertFile(params) {
      const values = [
        params.repoId,
        params.path,
        params.language,
        params.content,
        params.contentHash,
        params.mtime,
        params.sizeBytes,
        params.lineCount,
      ];
      try {
        const rows = sqlJson(
          'INSERT INTO code_files (repo_id, path, language, content, content_hash, mtime, size_bytes, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
          values,
        );
        if (rows && rows[0] && rows[0].id) {
          return rows[0].id;
        }
      } catch {
        // Older SQLite-compatible engines may not support RETURNING.
        // The fallback insert-then-lookup path keeps indexing portable.
      }
      sqlRun(
        'INSERT INTO code_files (repo_id, path, language, content, content_hash, mtime, size_bytes, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        values,
      );
      return sqlJson('SELECT id FROM code_files WHERE repo_id = ? AND path = ?', [params.repoId, params.path])[0].id;
    },
    insertFileBatch(records) {
      const ids = [];
      const self = this;
      _withTransaction(() => {
        for (const params of records) {
          const id = self.insertFile(params);
          ids.push(id);
        }
      });
      return ids;
    },
    updateFile(fileId, params) {
      sqlRun(
        'UPDATE code_files SET content = ?, content_hash = ?, mtime = ?, size_bytes = ?, line_count = ?, language = ? WHERE id = ?',
        [params.content, params.contentHash, params.mtime, params.sizeBytes, params.lineCount, params.language, fileId],
      );
    },
    deleteFile(fileId) {
      sqlRun('DELETE FROM code_symbols WHERE file_id = ?', [fileId]);
      sqlRun('DELETE FROM code_files WHERE id = ?', [fileId]);
    },
    clearFileSymbols(fileId) {
      sqlRun('DELETE FROM code_symbols WHERE file_id = ?', [fileId]);
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
    insertSymbolBatch(symbols) {
      const self = this;
      _withTransaction(() => {
        for (const sym of symbols) {
          self.insertSymbol(sym);
        }
      });
    },
    updateRepoStats({ repoId, headCommit }) {
      sqlRun(
        "UPDATE code_repos SET file_count = (SELECT count(*) FROM code_files WHERE repo_id = ?), symbol_count = (SELECT count(*) FROM code_symbols WHERE repo_id = ?), head_commit = COALESCE(?, head_commit), updated_at = datetime('now') WHERE id = ?",
        [repoId, repoId, headCommit || null, repoId],
      );
    },
    listRepos() {
      return sqlJson(
        'SELECT name, path, file_count, symbol_count, indexed_at, updated_at FROM code_repos ORDER BY updated_at DESC',
      );
    },
    removeRepoByName(name) {
      const repo = this.findRepoByName(name);
      if (!repo) {
        return false;
      }
      sqlRun('DELETE FROM code_repos WHERE id = ?', [repo.id]);
      return true;
    },
    findSymbolSource({ repoName, filePath, symbolName }) {
      return (
        sqlJson(
          `SELECT s.*, f.content
         FROM code_symbols s
         JOIN code_files f ON f.id = s.file_id
         JOIN code_repos r ON r.id = s.repo_id
         WHERE r.name = ? AND s.file_path = ? AND s.name = ?
         LIMIT 1`,
          [repoName, filePath, symbolName],
        )[0] || null
      );
    },
  });
}

module.exports = { createCodeIndexRepository };
