import { createRequire } from 'node:module';
import type * as Sqlite from 'node:sqlite';

export type Database = Sqlite.DatabaseSync;

const nodeRequire = createRequire(import.meta.url);

/**
 * Loads Node's built-in SQLite driver. It is loaded lazily so the one-time "experimental"
 * warning can be filtered out of the server logs.
 */
function loadSqlite(): typeof Sqlite {
  const originalEmit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === 'string' ? warning : warning.message;
    if (message.includes('SQLite')) return;
    return (originalEmit as (...a: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return nodeRequire('node:sqlite') as typeof Sqlite;
  } finally {
    process.emitWarning = originalEmit;
  }
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    document TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    metadata TEXT,
    filmstrip TEXT,
    has_thumbnail INTEGER NOT NULL DEFAULT 0,
    has_waveform INTEGER NOT NULL DEFAULT 0,
    proxy_file TEXT,
    preview_ready INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX assets_by_project ON assets(project_id, created_at);
  CREATE TABLE renders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    settings TEXT NOT NULL,
    file_name TEXT NOT NULL,
    error TEXT,
    output_size INTEGER,
    output_duration REAL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX renders_by_project ON renders(project_id, created_at);
  `,
];

export function openDatabase(file: string): Database {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
  );
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
    { version: number | null } | undefined;
  const current = row?.version ?? 0;
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version - 1]!);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
