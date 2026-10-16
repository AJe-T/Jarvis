import { basename } from 'node:path';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';

/**
 * Every Claude Code session on this PC, and which ones are waiting on Sir (idea from
 * ethanplusai/jarvis, which does this on macOS). Read through the Agent SDK's own session API
 * (listSessions / getSessionMessages), so Jarvis never parses Claude Code's files itself and only
 * reads: it never writes to a session.
 */
export type SessionState = 'needs-you' | 'working' | 'finished' | 'idle';

export interface ClaudeSession {
  id: string;
  /** Folder name of the project, e.g. "Jarvis". */
  project: string;
  cwd: string;
  title: string;
  state: SessionState;
  lastModified: number;
  /** The tool the session is stuck on when state is 'needs-you'. */
  waitingFor?: string;
}

/** The two SDK calls Jarvis needs (injected so tests don't touch ~/.claude). */
export interface SessionSource {
  list(): Promise<
    Array<{
      sessionId: string;
      summary: string;
      lastModified: number;
      cwd?: string;
      customTitle?: string;
    }>
  >;
  messages(sessionId: string, cwd?: string): Promise<Array<{ type: string; message: unknown }>>;
}

/** What the end of a transcript says, cached by lastModified so unchanged files are read once. */
interface Tail {
  kind: 'tool-pending' | 'replied' | 'user';
  tool?: string;
}

/** A tool call with no result for this long is a permission prompt or question, not work. */
export const WAIT_MS = 30_000;
/** Tools Claude Code runs without asking; a long one is work, not a prompt. */
const NEVER_ASKS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'Task',
  'Agent',
  'TodoWrite',
  'WebSearch',
]);
/** A session whose last word is Sir's for this long was interrupted or closed. */
const STALL_MS = 2 * 60_000;
/** "Just finished" for this long, then idle. */
const RECENT_MS = 10 * 60_000;
/** Sessions untouched for a day are left out. */
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_SESSIONS = 15;

function blocks(message: unknown): Array<{ type?: string; name?: string }> {
  const content = (message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? (content as Array<{ type?: string; name?: string }>) : [];
}

export function readTail(messages: Array<{ type: string; message: unknown }>): Tail | null {
  const last = [...messages].reverse().find((m) => m.type === 'user' || m.type === 'assistant');
  if (!last) return null;
  if (last.type === 'user') return { kind: 'user' };
  const pending = blocks(last.message).find((b) => b.type === 'tool_use');
  return pending
    ? { kind: 'tool-pending', ...(pending.name ? { tool: pending.name } : {}) }
    : { kind: 'replied' };
}

export function stateOf(tail: Tail, age: number): SessionState {
  if (tail.kind === 'tool-pending')
    return age >= WAIT_MS && !NEVER_ASKS.has(tail.tool ?? '') ? 'needs-you' : 'working';
  if (tail.kind === 'user') return age < STALL_MS ? 'working' : 'idle';
  return age < RECENT_MS ? 'finished' : 'idle';
}

export function createSessionReader(source: SessionSource, now: () => number = Date.now) {
  const tails = new Map<string, { at: number; tail: Tail | null }>();
  return {
    async list(): Promise<ClaudeSession[]> {
      const t = now();
      const recent = (await source.list())
        .filter((s) => t - s.lastModified < MAX_AGE_MS)
        .sort((a, b) => b.lastModified - a.lastModified)
        .slice(0, MAX_SESSIONS);
      const out: ClaudeSession[] = [];
      for (const s of recent) {
        // ponytail: a busy session's transcript is re-read each poll (the SDK reads whole files);
        // fine for a few active sessions, tail-read the JSONL if many run at once.
        let cached = tails.get(s.sessionId);
        if (cached?.at !== s.lastModified) {
          cached = {
            at: s.lastModified,
            tail: readTail(await source.messages(s.sessionId, s.cwd)),
          };
          tails.set(s.sessionId, cached);
        }
        if (!cached.tail) continue;
        const state = stateOf(cached.tail, t - s.lastModified);
        out.push({
          id: s.sessionId,
          project: s.cwd ? basename(s.cwd) : 'unknown project',
          cwd: s.cwd ?? '',
          title: (s.customTitle ?? s.summary).replace(/\s+/g, ' ').slice(0, 120),
          state,
          lastModified: s.lastModified,
          ...(state === 'needs-you' && cached.tail.tool ? { waitingFor: cached.tail.tool } : {}),
        });
      }
      return out;
    },
  };
}

/** The real source: the Agent SDK, loaded only when the watcher or tool runs. */
export function sdkSessionSource(): SessionSource {
  const sdk = (): Promise<typeof Sdk> => import('@anthropic-ai/claude-agent-sdk');
  return {
    // Headless sessions (Jarvis's own brain, other SDK apps) are not Sir's work.
    list: async () => (await sdk()).listSessions({ limit: 40, includeProgrammatic: false }),
    messages: async (id, cwd) => (await sdk()).getSessionMessages(id, cwd ? { dir: cwd } : {}),
  };
}

/** What changed between two polls, worded for speech. Null when there's nothing to say. */
export function announcement(
  before: Map<string, SessionState>,
  now: ClaudeSession[],
  level: 'waiting' | 'all',
): string | null {
  const blocked = now.filter((s) => s.state === 'needs-you' && before.get(s.id) !== 'needs-you');
  const done =
    level === 'all'
      ? now.filter((s) => s.state === 'finished' && before.get(s.id) === 'working')
      : [];
  const parts: string[] = [];
  if (blocked.length === 1) {
    const s = blocked[0] as ClaudeSession;
    parts.push(
      `Claude Code in ${s.project} is waiting on you${s.waitingFor ? `; it wants to use ${s.waitingFor}` : ''}.`,
    );
  } else if (blocked.length > 1)
    parts.push(`${blocked.length} Claude Code sessions are waiting on you: ${names(blocked)}.`);
  if (done.length) parts.push(`Claude Code finished in ${names(done)}.`);
  return parts.length ? `Sir, ${parts.join(' ')}` : null;
}

const names = (xs: ClaudeSession[]): string => {
  const n = [...new Set(xs.map((x) => x.project))];
  return n.length < 2 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
};

/**
 * A session already announced stays quiet this long. A long Bash run (a build, the test suite)
 * looks exactly like a permission prompt in the transcript, so one busy session used to flip
 * working → needs-you on every command and announce itself a dozen times.
 */
export const REANNOUNCE_MS = 15 * 60_000;

/** Polls every 30 s while announcements are on; the first poll only learns the current states. */
export function createSessionWatcher(deps: {
  reader: ReturnType<typeof createSessionReader>;
  level: () => 'off' | 'waiting' | 'all';
  announce: (text: string) => void;
  onError: (err: unknown) => void;
  intervalMs?: number;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let known: Map<string, SessionState> | null = null;
  /** Session id → when it was last announced. */
  const told = new Map<string, number>();
  let runs = 0;
  let busy = false;
  async function poll(): Promise<void> {
    const level = deps.level();
    if (level === 'off') {
      // Turning announcements back on must not report what changed while they were off.
      known = null;
      runs++;
      return;
    }
    if (busy) return;
    const generation = ++runs;
    busy = true;
    try {
      const sessions = await deps.reader.list();
      if (generation !== runs) return; // stop() ran meanwhile
      const t = now();
      for (const [id, at] of told) if (t - at >= REANNOUNCE_MS) told.delete(id);
      // Recently announced sessions count as already waiting, so they don't trigger again.
      const before =
        known && new Map([...known, ...[...told.keys()].map((id) => [id, 'needs-you'] as const)]);
      const text = before ? announcement(before, sessions, level) : null;
      if (before && text)
        for (const s of sessions) {
          const was = before.get(s.id);
          const blocked = s.state === 'needs-you' && was !== 'needs-you';
          const done = level === 'all' && s.state === 'finished' && was === 'working';
          if (blocked || done) told.set(s.id, t);
        }
      known = new Map(sessions.map((s) => [s.id, s.state]));
      if (text) deps.announce(text);
    } catch (err) {
      deps.onError(err);
    } finally {
      busy = false;
    }
  }
  return {
    poll,
    start(): void {
      if (timer) return;
      timer = setInterval(() => void poll(), deps.intervalMs ?? 30_000);
      timer.unref();
      void poll();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
      known = null;
      runs++;
    },
  };
}
