import { execFile, spawn } from 'node:child_process';
import { ToolError } from '../errors';
import { truncate } from '../lib/util';

export interface PsResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PsOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Parameters are passed as JSON in an environment variable, never spliced into the script text. */
  params?: Record<string, unknown>;
}

const MAX_OUTPUT = 20 * 1024;

function killTree(pid: number | undefined): void {
  if (!pid) return;
  // taskkill /T also ends anything the script started (Start-Process, child exes).
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
    'error',
    () => undefined,
  );
}

/**
 * Child environment for powershell.exe. PSModulePath is dropped: one inherited from PowerShell 7
 * (a pwsh terminal, CI) points Windows PowerShell 5.1 at pwsh's modules, so built-ins like PKI
 * (the Cert: drive) fail to load. Without it, 5.1 rebuilds its own default path.
 */
export function psEnv(
  base: NodeJS.ProcessEnv,
  params?: Record<string, unknown>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (k.toLowerCase() !== 'psmodulepath') env[k] = v;
  env['JARVIS_PS_PARAMS'] = params ? JSON.stringify(params) : '';
  return env;
}

/**
 * Security.md §5.2 / Code-style.md §4.4: PowerShell via execFile + -EncodedCommand (UTF-16LE base64).
 * Never exec(), never string-built command lines. Runs as the current standard user.
 */
export function runPowerShell(script: string, opts: PsOptions = {}): Promise<PsResult> {
  const prelude = opts.params ? '$P = $env:JARVIS_PS_PARAMS | ConvertFrom-Json\n' : '';
  const encoded = Buffer.from(
    `$ProgressPreference='SilentlyContinue'\n${prelude}${script}`,
    'utf16le',
  ).toString('base64');
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted)
      return reject(new ToolError('Cancelled before it started.', 'CANCELLED'));
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: psEnv(process.env, opts.params),
      },
      (err, stdout, stderr) => {
        opts.signal?.removeEventListener('abort', onAbort);
        if (err && (err as { killed?: boolean }).killed) {
          killTree(child.pid);
          return reject(
            new ToolError(`Timed out after ${Math.round(timeoutMs / 1000)} s.`, 'TOOL_TIMEOUT'),
          );
        }
        const code =
          typeof (err as { code?: unknown } | null)?.code === 'number'
            ? (err as { code: number }).code
            : 0;
        resolve({
          stdout: truncate(stdout.trim(), MAX_OUTPUT),
          stderr: truncate(stderr.trim(), MAX_OUTPUT),
          exitCode: code,
        });
      },
    );
    const onAbort = (): void => {
      killTree(child.pid);
      reject(new ToolError('Stopped.', 'CANCELLED'));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs a script and returns parsed JSON from stdout (scripts end with `ConvertTo-Json -Compress`). */
export async function runPowerShellJson<T>(script: string, opts: PsOptions = {}): Promise<T> {
  const r = await runPowerShell(script, opts);
  if (r.exitCode !== 0)
    throw new ToolError(r.stderr || `PowerShell exited with code ${r.exitCode}.`);
  if (!r.stdout) return [] as unknown as T;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new ToolError(`Unexpected PowerShell output: ${r.stdout.slice(0, 200)}`);
  }
}
