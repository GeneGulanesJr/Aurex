import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const AUREX_VERSION_OFFSET = 100;

const migrationCache: Map<string, string> = new Map();

function loadMigrations(): string[] {
  if (migrationCache.size > 0) {
    return Array.from(migrationCache.keys()).sort();
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    migrationCache.set(file, sql);
  }

  return files;
}

export function runMigrations(db: Database.Database): void {
  const files = loadMigrations();
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  const targetVersion = AUREX_VERSION_OFFSET + files.length;

  if (currentVersion >= AUREX_VERSION_OFFSET && currentVersion >= targetVersion) {
    return;
  }

  const startIndex = currentVersion >= AUREX_VERSION_OFFSET
    ? currentVersion - AUREX_VERSION_OFFSET
    : 0;

  for (let i = startIndex; i < files.length; i++) {
    const file = files[i];
    const sql = migrationCache.get(file)!;

    db.exec('BEGIN TRANSACTION');
    try {
      db.exec(sql);
      db.pragma(`user_version = ${AUREX_VERSION_OFFSET + i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
