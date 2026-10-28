import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;
export type SqlValue = string | number | bigint | null | Uint8Array;

// Migrations are bundled as raw strings so the packaged app needs no SQL files on disk.
const MIGRATION_FILES = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function bundledMigrations(): Migration[] {
  return Object.entries(MIGRATION_FILES)
    .map(([file, sql]) => {
      const m = /(\d{3})_([\w-]+)\.sql$/.exec(file);
      if (!m?.[1] || !m[2]) throw new Error(`Bad migration file name: ${file}`);
      return { version: Number(m[1]), name: m[2], sql };
    })
    .sort((a, b) => a.version - b.version);
}

/** Database.md §2 connection settings. */
export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

const txDepth = new WeakMap<Db, number>();

/** Runs fn inside a transaction (nested calls join the outer one). */
export function tx<T>(db: Db, fn: () => T): T {
  const depth = txDepth.get(db) ?? 0;
  if (depth > 0) {
    txDepth.set(db, depth + 1);
    try {
      return fn();
    } finally {
      txDepth.set(db, depth);
    }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth.set(db, 0);
  }
}

export function pendingMigrations(db: Db, migrations = bundledMigrations()): Migration[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
  );
  return migrations.filter((m) => !applied.has(m.version));
}

/** Database.md §6: in order, each inside a transaction, recorded in schema_migrations. */
export function migrate(db: Db, migrations = bundledMigrations()): number {
  const pending = pendingMigrations(db, migrations);
  for (const m of pending) {
    tx(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    });
  }
  return pending.length;
}

export function quickCheck(db: Db): boolean {
  const row = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
  return row !== undefined && Object.values(row)[0] === 'ok';
}

// ── Backups (Database.md §7) ─────────────────────────────────────────────────────────────────

const BACKUP_RE = /^jarvis-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.db$/;
const KEEP_BACKUPS = 7;

function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function listBackups(dir: string): Array<{ file: string; createdAt: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => BACKUP_RE.test(f))
    .sort()
    .reverse()
    .map((file) => ({ file, createdAt: statSync(join(dir, file)).mtime.toISOString() }));
}

export function backupNow(db: Db, dir: string, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `jarvis-${stamp(now)}.db`);
  if (existsSync(target)) rmSync(target);
  // VACUUM INTO works on every Node version we run (ADR-009).
  db.prepare('VACUUM INTO ?').run(target);
  for (const old of listBackups(dir).slice(KEEP_BACKUPS))
    rmSync(join(dir, old.file), { force: true });
  return target;
}

/**
 * Database.md §7: marks backups/<file> to replace the database on the next start (applied before it
 * opens), keeping the current data in pre-restore.db, outside the rotating backup set.
 * `source`: a backup kept elsewhere (Forge's, ADR-046) is first copied in as the newest backup, so
 * pruning can't remove it before the restart.
 */
export function scheduleRestore(
  db: Db,
  userData: string,
  backup: { file: string } | { source: string },
  now = new Date(),
): string {
  const dir = join(userData, 'backups');
  let file: string;
  if ('source' in backup) {
    mkdirSync(dir, { recursive: true });
    file = `jarvis-${stamp(now)}.db`;
    copyFileSync(backup.source, join(dir, file));
  } else file = backup.file;
  const safety = join(userData, 'pre-restore.db');
  rmSync(safety, { force: true });
  db.prepare('VACUUM INTO ?').run(safety);
  writeFileSync(join(userData, 'restore-pending.json'), JSON.stringify({ file }));
  return file;
}

/** Backs up when the newest backup is older than 24 h. */
export function backupIfStale(db: Db, dir: string, now = new Date()): string | null {
  const newest = listBackups(dir)[0];
  if (newest && now.getTime() - new Date(newest.createdAt).getTime() < 24 * 3600_000) return null;
  return backupNow(db, dir, now);
}
