import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * agent-desktop (vercel-labs/agent-desktop, Apache-2.0) is a native program that reads and drives
 * apps through Windows UI Automation and the Action Center. Jarvis runs it as a separate program
 * (never its code inside ours) when Sir has installed it (`npm install -g agent-desktop`): it is
 * much quicker than a PowerShell UI Automation query, and it can read and act on notifications.
 * Every call goes through Jarvis's own tools first, so the policy engine, the risky-button check,
 * the password and self-window refusals all still apply; agent-desktop's own MCP server is not used.
 * Arguments are an array (execFile, no shell). Each command prints one JSON envelope.
 */

export interface AdError {
  code: string;
  message: string;
  suggestion?: string;
  /** `not_delivered` = nothing reached the app, so another way may be tried. */
  disposition?: { delivery?: string; retry?: string };
}

export interface AdEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: AdError;
}

export type ExecFn = (
  file: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal },
) => Promise<string>;

export interface AgentDesktop {
  /** The program was found when Jarvis started. */
  available(): boolean;
  run<T>(
    args: string[],
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<AdEnvelope<T>>;
}

const DEFAULT_TIMEOUT = 20_000;
const MAX_OUT = 8 * 1024 * 1024;

/**
 * Where `npm install -g agent-desktop` puts the Windows program. PATH is not searched: any folder on
 * it could hold a program of that name, and this one gets to read notifications.
 */
export function findAgentDesktop(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  arch: string = process.arch,
): string | null {
  const candidates: string[] = [];
  const appData = env['APPDATA'];
  if (appData)
    candidates.push(
      join(
        appData,
        'npm',
        'node_modules',
        'agent-desktop',
        'bin',
        `agent-desktop-win32-${arch}.exe`,
      ),
    );
  return candidates.find((p) => exists(p)) ?? null;
}

const execFileText: ExecFn = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: opts.timeoutMs,
        windowsHide: true,
        maxBuffer: MAX_OUT,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      // A failed command still prints its envelope (with a non-zero exit code): read it either way.
      (err, stdout) => (stdout ? resolve(String(stdout)) : reject(err ?? new Error('no output'))),
    );
  });

/** The one JSON envelope a command prints (the last JSON line, in case anything came before it). */
export function parseEnvelope<T>(stdout: string): AdEnvelope<T> {
  const lines = stdout.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const v = JSON.parse(t) as AdEnvelope<T>;
      if (typeof v.ok === 'boolean') return v;
    } catch {
      // not the envelope
    }
  }
  try {
    const v = JSON.parse(stdout) as AdEnvelope<T>;
    if (typeof v.ok === 'boolean') return v;
  } catch {
    // fall through
  }
  return { ok: false, error: { code: 'BAD_OUTPUT', message: 'agent-desktop printed no JSON' } };
}

export function createAgentDesktop(deps: {
  path(): string | null;
  enabled(): boolean;
  exec?: ExecFn;
}): AgentDesktop {
  const exec = deps.exec ?? execFileText;
  return {
    available: () => deps.enabled() && deps.path() !== null,
    async run<T>(args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}) {
      const file = deps.path();
      if (!file || !deps.enabled())
        return {
          ok: false,
          error: { code: 'NOT_INSTALLED', message: 'agent-desktop is not installed' },
        };
      try {
        const out = await exec(file, args, {
          timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        return parseEnvelope<T>(out);
      } catch (err) {
        return {
          ok: false,
          error: { code: 'EXEC_FAILED', message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };
}

// ── Reading its answers ──────────────────────────────────────────────────────────────────────

export interface AdNode {
  role?: string;
  name?: string;
  value?: string;
  ref_id?: string;
  states?: string[];
  children?: AdNode[];
}

/** Every node with a ref (an element Jarvis can act on), depth first, at most `max`. */
export function flattenRefs(tree: AdNode | undefined, max: number): AdNode[] {
  const out: AdNode[] = [];
  const visit = (n: AdNode | undefined, depth: number): void => {
    if (!n || out.length >= max || depth > 40) return;
    if (n.ref_id && (n.name || n.value)) out.push(n);
    for (const c of n.children ?? []) visit(c, depth + 1);
  };
  visit(tree, 0);
  return out;
}

export interface AdNotification {
  index: number;
  app_name?: string;
  title?: string;
  body?: string;
  actions?: string[];
}

/** The notification list, wherever the envelope keeps it (the entries carry a 1-based `index`). */
export function notificationsOf(data: unknown): AdNotification[] {
  const isList = (v: unknown): v is AdNotification[] =>
    Array.isArray(v) && v.every((x) => typeof (x as AdNotification)?.index === 'number');
  if (isList(data)) return data;
  if (data && typeof data === 'object')
    for (const v of Object.values(data as Record<string, unknown>)) if (isList(v)) return v;
  return [];
}

/** The matches `find` returned that carry a ref. */
export function matchesOf(data: unknown): AdNode[] {
  const m = (data as { matches?: AdNode[] } | undefined)?.matches;
  return Array.isArray(m) ? m.filter((x) => typeof x.ref_id === 'string') : [];
}
