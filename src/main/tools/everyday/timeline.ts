import { z } from 'zod';
import type { Db } from '../../db/connection';
import { localDay } from '../../lib/util';
import { redact } from '../../security/redact';
import type { ForegroundWindow } from '../native/os';
import { defineTool, ok, type Tool } from '../types';

/**
 * Day timeline (our own take on screen-time trackers): which app and window was in front, sampled
 * once a minute while Sir is at the PC. Answers "where did my day go". Off until he turns it on.
 *
 * It records the app name and the window title only: never what is on the screen, never keys.
 * Private-browsing windows and password managers are recorded without a title (Security.md §16.18).
 */

// ponytail: one PowerShell start per sample (os.foregroundWindow). Fine at once a minute; use a
// long-lived watcher process if finer detail is ever wanted.
export const SAMPLE_SECONDS = 60;
const IDLE_SECONDS = 120;
const KEEP_DAYS = 30;
const TITLE_CHARS = 120;
const TOP_WINDOWS = 5;
export const PRIVATE_TITLE = /inprivate|incognito|private browsing|private window/i;
export const PRIVATE_PROCESS =
  /keepass|1password|bitwarden|lastpass|dashlane|keeper|enpass|nordpass|protonpass|roboform/i;
/** The lock screen and the desktop itself are not "using an app". */
export const NOT_AN_APP = /^(lockapp|logonui|idle)$/i;

export interface TimelineApp {
  process: string;
  seconds: number;
  windows: Array<{ title: string; seconds: number }>;
}
export interface TimelineDay {
  day: string;
  totalSeconds: number;
  apps: TimelineApp[];
}

export interface TimelineDeps {
  db: Db;
  foreground(): Promise<ForegroundWindow>;
  /** Seconds since the last key press or mouse move. */
  idleSeconds(): number;
  enabled(): boolean;
  now?: () => Date;
}

export type Timeline = ReturnType<typeof createTimeline>;

export function createTimeline(d: TimelineDeps) {
  const now = d.now ?? ((): Date => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;

  /** One look at the window in front; adds a minute to it unless Sir is away or it is off. */
  async function sample(): Promise<void> {
    if (busy || !d.enabled() || d.idleSeconds() >= IDLE_SECONDS) return;
    busy = true;
    try {
      const w = await d.foreground().catch(() => null);
      const process = w?.process.trim() ?? '';
      if (!w || !process || NOT_AN_APP.test(process)) return;
      const isPrivate = PRIVATE_PROCESS.test(process) || PRIVATE_TITLE.test(w.title);
      const title = isPrivate ? '' : redact(w.title).trim().slice(0, TITLE_CHARS);
      const at = now();
      d.db
        .prepare(
          `INSERT INTO app_usage (day, process, title, seconds, last_seen) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (day, process, title)
           DO UPDATE SET seconds = seconds + excluded.seconds, last_seen = excluded.last_seen`,
        )
        .run(localDay(at), process, title, SAMPLE_SECONDS, at.toISOString());
    } finally {
      busy = false;
    }
  }

  function prune(): void {
    const cutoff = new Date(now().getTime() - KEEP_DAYS * 86_400_000);
    d.db.prepare('DELETE FROM app_usage WHERE day < ?').run(localDay(cutoff));
  }

  return {
    sample,
    prune,
    start(): void {
      prune();
      timer ??= setInterval(() => void sample(), SAMPLE_SECONDS * 1000);
      timer.unref?.();
    },
    stop(): void {
      clearInterval(timer);
      timer = undefined;
    },
    /** Apps by time for one local day (default today), each with its most-used windows. */
    day(day = localDay(now())): TimelineDay {
      const rows = d.db
        .prepare(
          'SELECT process, title, seconds FROM app_usage WHERE day = ? ORDER BY seconds DESC',
        )
        .all(day) as Array<{ process: string; title: string; seconds: number }>;
      const apps = new Map<string, TimelineApp>();
      for (const r of rows) {
        const app = apps.get(r.process) ?? { process: r.process, seconds: 0, windows: [] };
        app.seconds += r.seconds;
        if (r.title && app.windows.length < TOP_WINDOWS)
          app.windows.push({ title: r.title, seconds: r.seconds });
        apps.set(r.process, app);
      }
      const list = [...apps.values()].sort((a, b) => b.seconds - a.seconds);
      return { day, totalSeconds: list.reduce((n, a) => n + a.seconds, 0), apps: list };
    },
    /** Deletes everything recorded (Settings → Activity → My day → Clear). */
    clear(): void {
      d.db.prepare('DELETE FROM app_usage').run();
    },
  };
}

/** 4980 → "1 h 23 min"; 300 → "5 min". */
export function duration(seconds: number): string {
  const min = Math.round(seconds / 60);
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

export function createTimelineTool(timeline: Timeline, enabled: () => boolean): Tool {
  return defineTool({
    name: 'day_timeline',
    description:
      'How long sir spent in each app on this PC on one day (default today), from the day timeline: "where did my day go", "how long was I in VS Code yesterday". With windows: true, the most-used window titles per app too. Only app names and window titles are recorded, once a minute while sir is at the PC, for 30 days. Empty unless sir turned on the day timeline in Settings → Privacy.',
    input: z.object({
      day: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      windows: z.boolean().default(false),
    }),
    tier: 'SAFE',
    untrustedOutput: true,
    summarize: ({ day }) => `Read the day timeline${day ? ` for ${day}` : ''}`,
    run({ day, windows }) {
      const t = timeline.day(day);
      if (t.apps.length === 0)
        return Promise.resolve(
          ok(
            enabled()
              ? `Nothing was recorded on ${t.day}.`
              : 'The day timeline is off, so nothing is recorded. Sir can turn it on in Settings → Privacy ("Keep a day timeline").',
          ),
        );
      const lines = t.apps.flatMap((a) => [
        `- ${a.process}: ${duration(a.seconds)}`,
        ...(windows ? a.windows.map((w) => `    · ${w.title}: ${duration(w.seconds)}`) : []),
      ]);
      return Promise.resolve({
        content: [
          {
            type: 'text' as const,
            text: `${t.day}: ${duration(t.totalSeconds)} at the PC.\n${lines.join('\n')}`,
          },
        ],
        untrustedSource: 'window titles',
      });
    },
  });
}
