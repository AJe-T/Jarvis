import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../db/connection';
import { errorMessage } from '../../errors';
import { logger } from '../../logging/logger';
import { redact } from '../../security/redact';
import type { OsAdapter } from '../native/os';
import { defineTool, ok, type Tool } from '../types';
import { screenTextLines } from './screen';
import { NOT_AN_APP, PRIVATE_PROCESS, PRIVATE_TITLE } from './timeline';

/**
 * Screen memory (idea from Screenpipe and Rewind; code is ours): while Sir turned it on, the text
 * on the main screen is read by Windows OCR on this PC and kept, so "what was that error I saw at
 * three" has an answer. Text only: the screenshot is deleted as soon as it is read.
 *
 * Security.md §16.22. Never read: Jarvis's own window, private-browsing windows, password
 * managers, the lock screen, apps Sir excluded, or anything while he is away. Secrets are redacted
 * before a row is written. Nothing leaves the PC unless Sir asks Jarvis about it (CONFIRM).
 */

export const CAPTURE_SECONDS = 60;
const IDLE_SECONDS = 120;
/** The same window is read again only after this long (or when its text changed app/title). */
const SAME_WINDOW_MS = 5 * 60_000;
const MAX_TEXT = 20_000;
const MIN_TEXT = 20;
const SNIPPET_BEFORE = 80;
const SNIPPET_AFTER = 160;

export interface ScreenHit {
  id: number;
  at: string;
  process: string;
  title: string;
  snippet: string;
}

export interface ScreenMemoryDeps {
  db: Db;
  os: Pick<OsAdapter, 'captureScreen' | 'psJson' | 'foregroundWindow'>;
  /** Seconds since the last key press or mouse move. */
  idleSeconds(): number;
  enabled(): boolean;
  /** App (process) names Sir never wants read, separated by commas or new lines. */
  excluded(): string;
  keepDays(): number;
  /** Jarvis's own process id: his window can show passwords and private chats. */
  ownPid: number;
  now?: () => Date;
}

export type ScreenMemory = ReturnType<typeof createScreenMemory>;

export function createScreenMemory(d: ScreenMemoryDeps) {
  const now = d.now ?? ((): Date => new Date());
  const log = logger.child({ module: 'screen-memory' });
  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  let last: { key: string; at: number; hash: string } | null = null;
  let lastPrune = 0;

  const excludedApps = (): string[] =>
    d
      .excluded()
      .split(/[,\n]/)
      .map((a) =>
        a
          .trim()
          .toLowerCase()
          .replace(/\.exe$/, ''),
      )
      .filter(Boolean);

  /** May this window be read at all? */
  function readable(w: { process: string; title: string; pid: number }): boolean {
    const process = w.process.trim();
    if (!process || NOT_AN_APP.test(process) || w.pid === d.ownPid) return false;
    if (PRIVATE_PROCESS.test(process) || PRIVATE_TITLE.test(w.title)) return false;
    return !excludedApps().includes(process.toLowerCase());
  }

  function prune(): void {
    const cutoff = new Date(now().getTime() - d.keepDays() * 86_400_000).toISOString();
    d.db.prepare('DELETE FROM screen_memory WHERE at < ?').run(cutoff);
    lastPrune = now().getTime();
  }

  /** One look: reads the screen if Sir is there and the window in front may be read. */
  async function capture(): Promise<'saved' | 'skipped'> {
    if (busy || !d.enabled() || d.idleSeconds() >= IDLE_SECONDS) return 'skipped';
    busy = true;
    try {
      const before = await d.os.foregroundWindow().catch(() => null);
      if (!before || !readable(before)) return 'skipped';
      const key = `${before.process}|${before.title}`;
      const at = now();
      if (last && last.key === key && at.getTime() - last.at < SAME_WINDOW_MS) return 'skipped';
      const lines = await screenTextLines(d.os);
      // The screenshot shows whatever is in front NOW: if Sir switched windows meanwhile (perhaps
      // to a private one), what was read is not this window's text and is thrown away.
      const after = await d.os.foregroundWindow().catch(() => null);
      if (!after || after.hwnd !== before.hwnd || !readable(after)) return 'skipped';
      const text = redact(lines.join('\n')).slice(0, MAX_TEXT);
      const hash = createHash('sha256').update(text).digest('hex');
      const unchanged = last?.key === key && last.hash === hash;
      last = { key, at: at.getTime(), hash };
      if (text.length < MIN_TEXT || unchanged) return 'skipped';
      d.db
        .prepare('INSERT INTO screen_memory (at, process, title, text) VALUES (?, ?, ?, ?)')
        .run(at.toISOString(), before.process, redact(before.title).slice(0, 200), text);
      if (at.getTime() - lastPrune > 3_600_000) prune();
      return 'saved';
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'screen memory capture failed');
      return 'skipped';
    } finally {
      busy = false;
    }
  }

  return {
    capture,
    prune,
    start(): void {
      prune();
      timer ??= setInterval(() => void capture(), CAPTURE_SECONDS * 1000);
      timer.unref?.();
    },
    stop(): void {
      clearInterval(timer);
      timer = undefined;
    },
    /** Captures where every word appears, newest first, with the text around the first word. */
    search(query: string, limit = 5, day?: string): ScreenHit[] {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
      if (words.length === 0) return [];
      // ponytail: LIKE over at most a few thousand rows (one a minute, a week). An FTS table if
      // Sir keeps months of it.
      const like = words.map(() => "lower(text) LIKE ? ESCAPE '\\'").join(' AND ');
      const args = words.map((w) => `%${w.replace(/[\\%_]/g, '\\$&')}%`);
      const rows = d.db
        .prepare(
          `SELECT id, at, process, title, text FROM screen_memory
           WHERE ${like}${day ? ' AND substr(at, 1, 10) = ?' : ''} ORDER BY at DESC LIMIT ?`,
        )
        .all(...args, ...(day ? [day] : []), limit) as Array<{
        id: number;
        at: string;
        process: string;
        title: string;
        text: string;
      }>;
      return rows.map((r) => {
        const i = Math.max(r.text.toLowerCase().indexOf(words[0] ?? ''), 0);
        const from = Math.max(i - SNIPPET_BEFORE, 0);
        const cut = r.text
          .slice(from, i + SNIPPET_AFTER)
          .replace(/\s+/g, ' ')
          .trim();
        return {
          id: r.id,
          at: r.at,
          process: r.process,
          title: r.title,
          snippet: `${from > 0 ? '…' : ''}${cut}${i + SNIPPET_AFTER < r.text.length ? '…' : ''}`,
        };
      });
    },
    /** The whole text of one capture (for "copy it" in the command palette). */
    text(id: number): string | undefined {
      const row = d.db.prepare('SELECT text FROM screen_memory WHERE id = ?').get(id) as
        { text: string } | undefined;
      return row?.text;
    },
    count(): number {
      return (d.db.prepare('SELECT count(*) AS n FROM screen_memory').get() as { n: number }).n;
    },
    clear(): void {
      d.db.prepare('DELETE FROM screen_memory').run();
      last = null;
    },
  };
}

/** "2026-11-11T09:32:10.000Z" → "2026-11-11 15:02" in local time. */
function localStamp(iso: string): string {
  const t = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

export function createScreenMemoryTool(memory: ScreenMemory, enabled: () => boolean): Tool {
  return defineTool({
    name: 'screen_memory',
    description:
      'Search what was on sir\'s screen earlier: the text Windows read on his main screen while screen memory was on (text only, kept about a week). Use it for "what was that error I saw at three", "which page had the pricing table". Every word must appear; day (YYYY-MM-DD) narrows it. Returns when, which app and window, and the text around the match. Asks sir first. Empty unless he turned on screen memory in Settings → Privacy.',
    input: z.object({
      query: z.string().trim().min(2).max(100),
      day: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    tier: 'CONFIRM',
    untrustedOutput: true,
    summarize: ({ query }) => `Search your screen memory for "${query}"`,
    confirm: ({ query }) => ({
      title: 'Let Jarvis search your screen memory?',
      actionLabel: 'Search',
      details: `Text that was on your screen and mentions "${query}" will be sent to the model.`,
      detailsKind: 'text',
    }),
    run({ query, day, limit }) {
      const hits = memory.search(query, limit, day);
      if (hits.length === 0)
        return Promise.resolve(
          ok(
            enabled() || memory.count() > 0
              ? `Nothing on the screen mentioned "${query}"${day ? ` on ${day}` : ''}.`
              : 'Screen memory is off, so nothing has been kept. Sir can turn it on in Settings → Privacy ("Keep a screen memory").',
          ),
        );
      const text = hits
        .map((h) => `[${localStamp(h.at)}] ${h.process} · ${h.title}\n${h.snippet}`)
        .join('\n---\n');
      return Promise.resolve({
        content: [{ type: 'text' as const, text }],
        untrustedSource: 'the screen',
      });
    },
  });
}
