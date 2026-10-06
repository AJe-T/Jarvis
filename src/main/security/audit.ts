import type { Db } from '../db/connection';
import { canonicalJson, nowIso, sha256 } from '../lib/util';
import { redactDeep } from './redact';

export type AuditActor = 'user' | 'agent' | 'system';

export interface AuditRow {
  seq: number;
  ts: string;
  actor: AuditActor;
  event: string;
  details_json: string;
  prev_hash: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

function rowHash(
  prev: string,
  ts: string,
  actor: string,
  event: string,
  detailsJson: string,
): string {
  return sha256(prev + canonicalJson({ ts, actor, event, details: detailsJson }));
}

/** Security.md §12: tamper-evident hash chain. hash = sha256(prev_hash + canonical(row)). */
export function createAuditLog(db: Db) {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1');
  const insert = db.prepare(
    'INSERT INTO audit_log (ts, actor, event, details_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)',
  );

  return {
    append(actor: AuditActor, event: string, details: Record<string, unknown>): void {
      const prev = (last.get() as { hash: string } | undefined)?.hash ?? GENESIS;
      const ts = nowIso();
      const detailsJson = canonicalJson(redactDeep(details));
      insert.run(ts, actor, event, detailsJson, prev, rowHash(prev, ts, actor, event, detailsJson));
    },

    list(limit: number, beforeSeq?: number): AuditRow[] {
      return (beforeSeq
        ? db
            .prepare('SELECT * FROM audit_log WHERE seq < ? ORDER BY seq DESC LIMIT ?')
            .all(beforeSeq, limit)
        : db
            .prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?')
            .all(limit)) as unknown as AuditRow[];
    },

    verify(): { ok: boolean; checked: number; brokenAt?: number } {
      let prev = GENESIS;
      let checked = 0;
      for (const r of db
        .prepare('SELECT * FROM audit_log ORDER BY seq')
        .iterate() as Iterable<AuditRow>) {
        if (
          r.prev_hash !== prev ||
          r.hash !== rowHash(r.prev_hash, r.ts, r.actor, r.event, r.details_json)
        ) {
          return { ok: false, checked, brokenAt: r.seq };
        }
        prev = r.hash;
        checked++;
      }
      return { ok: true, checked };
    },

    all(): AuditRow[] {
      return db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as AuditRow[];
    },
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;
