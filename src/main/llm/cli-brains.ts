import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { JarvisError } from '../errors';
import { newId } from '../lib/util';

/**
 * Sir's own AI subscriptions, used through each company's official command-line app, signed in
 * with his account (no API key): ChatGPT (Free/Go/Plus/Pro) through OpenAI's Codex CLI, Gemini
 * (Google AI Pro) through Google's Antigravity CLI. Paperclip and OpenClaw drive the same CLIs.
 * OpenCode (2.71) answers through whatever provider Sir signed it in to (`opencode auth login`).
 *
 * Security.md §CLI brains: they answer only. Codex runs in its read-only sandbox with Sir's Codex
 * config (MCP servers, rules) ignored; Antigravity runs without auto-approval, so any tool request
 * is refused. OpenCode runs its read-only "plan" agent with no plugins and no permission flag.
 * All start in an empty folder. Jarvis's own tools do the acting.
 * ⚠️ Flags verified on 2026-10-16 against codex-cli 0.163.0 and agy (`--help`).
 */

export type CliBrainId = 'chatgpt' | 'antigravity' | 'opencode';

export interface CliBrain {
  id: CliBrainId;
  label: string;
  /** The app's executable on this PC, or null when it isn't installed. */
  find(): string | null;
  /** One prompt → the final answer. */
  run(prompt: string, signal: AbortSignal): Promise<string>;
  /** Arguments that start the app's own sign-in in a console window. */
  loginArgs: string[];
  /** Signed in? null when the app can't say without spending a request. */
  signedIn(): Promise<boolean | null>;
  /** Where to get the app. */
  installHint: string;
}

const TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT = 200_000;
/** Antigravity takes the prompt as an argument; the end of a long one (the request) is kept. */
const MAX_ARG_PROMPT = 28_000;

/** Runs an executable (never a shell) with the prompt on stdin; resolves with stdout. */
export function runExe(
  exe: string,
  args: string[],
  opts: {
    stdin: string;
    cwd: string;
    signal: AbortSignal;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      ...(opts.env ? { env: opts.env } : {}),
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? TIMEOUT_MS);
    const onAbort = (): void => void child.kill();
    opts.signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d: Buffer) => (stdout = (stdout + d.toString()).slice(-MAX_OUTPUT)));
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-MAX_OUTPUT)));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(opts.stdin);
  });
}

type Runner = typeof runExe;

/** An API key in the environment would switch the app from Sir's plan to per-use billing. */
export function cliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of [
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'ANTHROPIC_API_KEY',
    'ELECTRON_RUN_AS_NODE',
  ])
    delete out[k];
  return out;
}

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

/** Last line of stderr that looks like an error, for the message Sir sees. */
function errorLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => /error|not logged|sign in|login/i.test(l));
  return (lines.at(-1) ?? stderr.trim().split(/\r?\n/).at(-1) ?? '').slice(0, 240);
}

export function createCliBrains(deps: {
  /** An empty working folder for the apps (userData/cli-brains). */
  workDir: string;
  env?: NodeJS.ProcessEnv;
  run?: Runner;
  exists?: (p: string) => boolean;
}): Record<CliBrainId, CliBrain> {
  const env = deps.env ?? process.env;
  const run = deps.run ?? runExe;
  const appData = env['APPDATA'] ?? '';
  const localAppData = env['LOCALAPPDATA'] ?? '';
  const exists = deps.exists ?? existsSync;
  const pick = (paths: string[]): string | null =>
    deps.exists ? (paths.find((p) => exists(p)) ?? null) : firstExisting(paths);
  const cwd = (): string => {
    mkdirSync(deps.workDir, { recursive: true });
    return deps.workDir;
  };

  const codexPaths = (): string[] => {
    const pkg = join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai');
    return [
      join(pkg, 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
      join(pkg, 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'),
    ];
  };

  const chatgpt: CliBrain = {
    id: 'chatgpt',
    label: 'ChatGPT (your plan, via Codex)',
    loginArgs: ['login'],
    installHint: 'In a terminal: npm i -g @openai/codex',
    async signedIn() {
      const exe = chatgpt.find();
      if (!exe) return false;
      const r = await run(exe, ['login', 'status'], {
        stdin: '',
        cwd: cwd(),
        signal: AbortSignal.timeout(20_000),
        timeoutMs: 20_000,
        env: cliEnv(env),
      }).catch(() => null);
      return r ? r.code === 0 && /logged in/i.test(r.stdout + r.stderr) : null;
    },
    find: () => pick(codexPaths()),
    async run(prompt, signal) {
      const exe = chatgpt.find();
      if (!exe)
        throw new JarvisError(
          'INVALID',
          'codex missing',
          'Install the Codex app first: run "npm i -g @openai/codex", then "codex login".',
        );
      const out = join(cwd(), `${newId('codex_')}.txt`);
      try {
        const r = await run(
          exe,
          [
            'exec',
            '--sandbox',
            'read-only',
            '--skip-git-repo-check',
            '--ephemeral',
            '--ignore-user-config',
            '--ignore-rules',
            '--color',
            'never',
            '-o',
            out,
            '-',
          ],
          { stdin: prompt, cwd: cwd(), signal, env: cliEnv(env) },
        );
        const answer = existsSync(out) ? readFileSync(out, 'utf8').trim() : '';
        if (r.code === 0 && answer) return answer;
        throw new JarvisError(
          'LLM_BAD_REQUEST',
          `codex exit ${r.code}: ${errorLine(r.stderr)}`,
          /log ?in|logged in|sign in|auth/i.test(r.stderr)
            ? 'ChatGPT is not signed in. Run "codex login" once and sign in with your ChatGPT account.'
            : `ChatGPT (Codex) failed: ${errorLine(r.stderr) || 'no answer'}`,
        );
      } finally {
        rmSync(out, { force: true });
      }
    },
  };

  const antigravity: CliBrain = {
    id: 'antigravity',
    label: 'Gemini (your Google plan, via Antigravity)',
    loginArgs: [],
    installHint: 'Install the Antigravity CLI from antigravity.google',
    signedIn: async () => null,
    find: () => pick([join(localAppData, 'agy', 'bin', 'agy.exe')]),
    async run(prompt, signal) {
      const exe = antigravity.find();
      if (!exe)
        throw new JarvisError(
          'INVALID',
          'agy missing',
          'Install the Antigravity CLI from antigravity.google, then run "agy" once and sign in.',
        );
      // One argument (no shell, so nothing in it is interpreted); Windows caps a command line at 32K.
      // "Request:" first, so a prompt (or its kept end) never starts with "-" and reads as a flag.
      const r = await run(exe, ['--print', `Request:\n${prompt.slice(-MAX_ARG_PROMPT)}`], {
        stdin: '',
        cwd: cwd(),
        signal,
        env: cliEnv(env),
      });
      const answer = r.stdout.trim();
      if (r.code === 0 && answer) return answer;
      // Not signed in: agy exits 0 and prints nothing.
      throw new JarvisError(
        'LLM_BAD_REQUEST',
        `agy exit ${r.code}: ${errorLine(r.stderr)}`,
        answer || r.code !== 0
          ? `Gemini (Antigravity) failed: ${errorLine(r.stderr) || 'no answer'}`
          : 'Gemini is not signed in. Run "agy" once in a terminal and sign in with your Google account.',
      );
    },
  };

  const opencodeExe = (): string | null => {
    const pkg = join(appData, 'npm', 'node_modules', 'opencode-ai', 'node_modules');
    return pick([
      join(pkg, 'opencode-windows-x64', 'bin', 'opencode.exe'),
      join(pkg, 'opencode-windows-x64-baseline', 'bin', 'opencode.exe'),
      join(pkg, 'opencode-windows-arm64', 'bin', 'opencode.exe'),
    ]);
  };

  const opencode: CliBrain = {
    id: 'opencode',
    label: 'OpenCode (its own sign-in)',
    loginArgs: ['auth', 'login'],
    installHint: 'In a terminal: npm i -g opencode-ai, then "opencode auth login"',
    find: opencodeExe,
    async signedIn() {
      const exe = opencodeExe();
      if (!exe) return false;
      const r = await run(exe, ['auth', 'list'], {
        stdin: '',
        cwd: cwd(),
        signal: AbortSignal.timeout(20_000),
        timeoutMs: 20_000,
        env: cliEnv(env),
      }).catch(() => null);
      const count = /(\d+)\s+credentials?/i.exec(r?.stdout ?? '');
      return r && r.code === 0 && count ? Number(count[1]) > 0 : null;
    },
    async run(prompt, signal) {
      const exe = opencodeExe();
      if (!exe)
        throw new JarvisError(
          'INVALID',
          'opencode missing',
          'Install OpenCode first: run "npm i -g opencode-ai", then "opencode auth login".',
        );
      // Its read-only "plan" agent, no plugins, in an empty folder, and no permission flag, so it
      // can only answer. One argument, like Antigravity ("Request:" first, so it never reads as a flag).
      const r = await run(
        exe,
        [
          'run',
          '--format',
          'json',
          '--agent',
          'plan',
          '--pure',
          '--dir',
          cwd(),
          `Request:\n${prompt.slice(-MAX_ARG_PROMPT)}`,
        ],
        { stdin: '', cwd: cwd(), signal, env: cliEnv(env) },
      );
      // It exits 0 even when the provider refused the request: the JSON events say what happened.
      const { answer, error } = openCodeAnswer(r.stdout);
      if (r.code === 0 && answer && !error) return answer;
      const why = error ?? (errorLine(r.stderr) || 'no answer');
      throw new JarvisError(
        'LLM_BAD_REQUEST',
        `opencode exit ${r.code}: ${why}`,
        /auth|credential|sign in|log ?in|401|api key/i.test(why)
          ? `OpenCode is not signed in to its provider (${why}). Run "opencode auth login" once.`
          : `OpenCode failed: ${why}`,
      );
    },
  };

  return { chatgpt, antigravity, opencode };
}

/**
 * Reads OpenCode's `run --format json` output: one JSON object per line. `text` events carry a
 * finished piece of the answer in `part.text`; an `error` event carries the provider's message.
 * ⚠️ Event shapes checked 2026-11-11 against opencode 1.14.48 (the error event live; the text
 * event from how the program writes it, since no provider would answer on this PC).
 */
export function openCodeAnswer(stdout: string): { answer: string; error: string | null } {
  const texts: string[] = [];
  let error: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // a cut-off or non-JSON line
    }
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as {
      type?: unknown;
      part?: { text?: unknown };
      error?: { name?: unknown; data?: { message?: unknown } };
    };
    if (e.type === 'text' && typeof e.part?.text === 'string') texts.push(e.part.text.trim());
    if (e.type === 'error') {
      const message = e.error?.data?.message;
      const name = e.error?.name;
      error = (typeof message === 'string' ? message : typeof name === 'string' ? name : 'error')
        .replace(/\s+/g, ' ')
        .slice(0, 240);
    }
  }
  return { answer: texts.filter(Boolean).join('\n\n'), error };
}
