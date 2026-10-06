import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { PolicyError } from '../errors';

const win = path.win32;

export interface PathGuardConfig {
  /** Folders Jarvis may touch (Settings → Files & permissions). */
  allowedRoots(): string[];
  /** Always denied even inside an allowed root: secrets, DB, browser profile, AppData, .ssh … */
  deniedPaths(): string[];
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

const SYSTEM_DENIED = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\$Recycle.Bin',
  'C:\\System Volume Information',
];
// Control characters (including NUL) are illegal in Windows paths and a classic truncation trick.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f<>"|?*]/;

function lower(p: string): string {
  return p.toLowerCase();
}

/** Resolves symlinks/junctions; for paths that don't exist yet, resolves the nearest existing ancestor. */
function realish(p: string): string {
  let current = p;
  const tail: string[] = [];
  for (;;) {
    if (existsSync(current)) {
      try {
        return win.join(realpathSync.native(current), ...tail.reverse());
        /* v8 ignore next 3 -- realpath of an existing path only fails on access-denied junctions */
      } catch {
        return win.join(current, ...tail.reverse());
      }
    }
    const parent = win.dirname(current);
    if (parent === current) return win.join(current, ...tail.reverse());
    tail.push(win.basename(current));
    current = parent;
  }
}

function within(child: string, root: string): boolean {
  const c = lower(child);
  const r = lower(root).replace(/[\\/]+$/, '');
  return c === r || c.startsWith(`${r}\\`);
}

/** Security.md §5.1. */
export function createPathGuard(config: PathGuardConfig) {
  const env = config.env ?? process.env;

  function expand(input: string): string | null {
    let out = input;
    if (out.startsWith('~') && config.homeDir) out = config.homeDir + out.slice(1);
    let unknownVar = false;
    out = out.replace(/%([A-Za-z_][A-Za-z0-9_()]*)%/g, (_m, name: string) => {
      const v = env[name] ?? env[name.toUpperCase()];
      if (!v) unknownVar = true;
      return v ?? '';
    });
    return unknownVar ? null : out;
  }

  function check(input: string): PathCheck {
    if (typeof input !== 'string' || input.length === 0 || input.length > 1024)
      return { ok: false, reason: 'Path is empty or too long.' };
    const expanded = expand(input);
    if (expanded === null)
      return { ok: false, reason: 'Path uses an unknown environment variable.' };
    const p = expanded.replace(/\//g, '\\');
    if (BAD_CHARS.test(p))
      return { ok: false, reason: 'Path contains characters Windows does not allow.' };
    if (p.startsWith('\\\\'))
      return { ok: false, reason: 'Network (UNC) and device paths are not allowed.' };
    if (!/^[A-Za-z]:\\/.test(p))
      return { ok: false, reason: 'Use a full path such as C:\\Users\\…\\Documents\\file.txt.' };
    if (p.indexOf(':', 2) !== -1)
      return { ok: false, reason: 'Alternate data streams are not allowed.' };
    const segments = p.slice(3).split('\\').filter(Boolean);
    if (segments.some((s) => s !== '.' && s !== '..' && /[. ]$/.test(s)))
      return { ok: false, reason: 'Path segments may not end with a dot or space.' };

    const resolved = realish(win.resolve(p));
    for (const denied of [...SYSTEM_DENIED, ...config.deniedPaths()]) {
      if (within(resolved, realish(win.resolve(denied))))
        return { ok: false, reason: `${resolved} is in a protected location.` };
    }
    const roots = config.allowedRoots().map((r) => realish(win.resolve(r)));
    if (!roots.some((r) => within(resolved, r)))
      return {
        ok: false,
        reason: `${resolved} is outside the folders Jarvis may use (Settings → Files & permissions).`,
      };
    return { ok: true, path: resolved };
  }

  return {
    check,
    /** Returns the resolved path or throws PolicyError. Call immediately before use (TOCTOU). */
    resolve(input: string): string {
      const r = check(input);
      if (!r.ok) throw new PolicyError(r.reason);
      return r.path;
    },
    isRoot(resolved: string): boolean {
      return config.allowedRoots().some((r) => lower(realish(win.resolve(r))) === lower(resolved));
    },
  };
}

export type PathGuard = ReturnType<typeof createPathGuard>;

export function defaultDeniedPaths(home: string, userData: string): string[] {
  return [
    win.join(home, 'AppData'),
    win.join(home, '.ssh'),
    win.join(home, '.aws'),
    win.join(home, '.gnupg'),
    // Jarvis's own data (Security.md §5.1): secrets, database, logs, backups, browser profile, MCP config.
    ...[
      'secrets.bin',
      'jarvis.db',
      'jarvis.db-wal',
      'jarvis.db-shm',
      'logs',
      'backups',
      'browser-profile',
      'mcp.json',
    ].map((f) => win.join(userData, f)),
  ];
}
