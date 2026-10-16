import type { Db } from '../db/connection';
import { newId, nowIso } from '../lib/util';
import type { TurnEnd } from './orchestrator';

/**
 * Approaches that worked (idea from ruflo's ReasoningBank, our own code): after a chat turn where
 * several tools all succeeded, the tool sequence is remembered with Sir's request. When a similar
 * request comes again, the approach is offered to Claude as a hint, once it has worked twice
 * (ruflo's "promotion" rule). Only tool names are kept, never inputs or results.
 */

/** Hints need this many wins, and at least twice as many wins as failures. */
export const PROMOTE_AT = 2;
/** Word overlap (Jaccard) for two requests to count as "the same kind". */
const SAME_KIND = 0.5;
/** Word overlap for a stored approach to be worth hinting. */
const HINT_AT = 0.35;
const MAX_ROWS = 500;

const STOP = new Set(
  'the a an and or to of in on for with my me i you your it this that is are be please can could would jarvis sir hey then also just some'.split(
    ' ',
  ),
);

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** Repeated calls of one tool in a row count once: [search, search, open] → [search, open]. */
export function sequence(tools: string[]): string[] {
  return tools.filter((t, i) => t !== tools[i - 1]);
}

interface Row {
  id: string;
  request: string;
  tools_json: string;
  successes: number;
  failures: number;
}

export function createStrategyStore(db: Db, now: () => string = nowIso) {
  // ponytail: word-overlap scan over ≤ 500 rows; switch to the semantic index if hints miss paraphrases.
  const all = (): Row[] =>
    db
      .prepare('SELECT id, request, tools_json, successes, failures FROM strategies')
      .all() as unknown as Row[];

  function find(request: string, toolsJson: string | null, min: number): Row | undefined {
    const w = words(request);
    let best: { row: Row; score: number } | undefined;
    for (const row of all()) {
      if (toolsJson !== null && row.tools_json !== toolsJson) continue;
      const score = overlap(w, words(row.request));
      if (score >= min && (!best || score > best.score)) best = { row, score };
    }
    return best?.row;
  }

  return {
    /** Records how a chat turn with tools went (call only for turns worth learning from). */
    record(request: string, tools: string[], ok: boolean): void {
      const seq = sequence(tools);
      if (seq.length < 2) return;
      const toolsJson = JSON.stringify(seq);
      const existing = find(request, toolsJson, SAME_KIND);
      if (existing) {
        db.prepare(
          `UPDATE strategies SET ${ok ? 'successes = successes + 1' : 'failures = failures + 1'}, updated_at = ? WHERE id = ?`,
        ).run(now(), existing.id);
        return;
      }
      if (!ok) return; // a failure with no known approach teaches nothing
      db.prepare(
        'INSERT INTO strategies (id, request, tools_json, successes, failures, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)',
      ).run(newId('strat_'), request.slice(0, 300), toolsJson, now(), now());
      db.prepare(
        `DELETE FROM strategies WHERE id NOT IN (SELECT id FROM strategies ORDER BY updated_at DESC LIMIT ${MAX_ROWS})`,
      ).run();
    },

    /** A one-line hint for this request, or '' when no proven approach matches. */
    hint(request: string): string {
      const w = words(request);
      const proven = all()
        .filter((r) => r.successes >= PROMOTE_AT && r.successes >= r.failures * 2)
        .map((r) => ({ r, score: overlap(w, words(r.request)) }))
        .filter((x) => x.score >= HINT_AT)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      return proven
        .map(
          ({ r }) =>
            `- For a request like "${r.request.slice(0, 120)}", ${(JSON.parse(r.tools_json) as string[]).join(' → ')} worked (${r.successes}×).`,
        )
        .join('\n');
    },
  };
}

export type StrategyStore = ReturnType<typeof createStrategyStore>;

/**
 * Learns from one finished turn. Only Sir's own chat turns with several tools count; private chats,
 * fast commands and turns that read outside content (which could have steered the tools) never do.
 * A turn where Sir declined or the policy blocked something isn't judged at all.
 */
export function learnFromTurn(store: StrategyStore, turn: TurnEnd): void {
  const w = turn.watch;
  if (!w || turn.purpose !== 'chat' || turn.isPrivate || turn.direct) return;
  if (turn.outcome !== 'end_turn' || w.tainted || w.injection) return;
  if (w.tools.length < 2 || w.tools.some((t) => !t.ran)) return;
  store.record(
    turn.userText,
    w.tools.map((t) => t.name),
    w.tools.every((t) => t.ok),
  );
}
