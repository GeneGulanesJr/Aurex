import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppConfig } from './config.js';

let _db: Database.Database | null = null;

export function openDatabase(config: AppConfig): Database.Database {
  if (_db) return _db;

  const dir = dirname(config.lapisDbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _db = new Database(config.lapisDbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  return _db;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call openDatabase() first.');
  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
