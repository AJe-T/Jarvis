import { execFile, spawn } from 'node:child_process';

/** Kills a process and everything it started (npx → node → Chrome, FFmpeg; npm → vitest → electron). */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
}

/** Runs a program (never a shell) and keeps the last `maxOut` characters of stdout + stderr. */
export function runProcess(
  file: string,
  args: string[],
  opts: {
    cwd: string;
    signal: AbortSignal;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
    maxOut: number;
  },
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, windowsHide: true });
    let out = '';
    const keep = (d: Buffer): void => {
      out = (out + d.toString('utf8')).slice(-opts.maxOut);
    };
    const stop = (): void => killTree(child.pid);
    const timer = setTimeout(stop, opts.timeoutMs);
    opts.signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', stop);
      resolve({ code, out });
    });
  });
}

/** `[path to node.exe, version]` of the Node on PATH, or null. */
export function systemNode(): Promise<{ exe: string; version: string } | null> {
  return new Promise((resolve) => {
    execFile(
      'node',
      ['-p', 'process.execPath + "|" + process.version'],
      { windowsHide: true, timeout: 5_000 },
      (err, stdout) => {
        const [exe, version] = stdout.trim().split('|');
        resolve(err || !exe || !version ? null : { exe, version });
      },
    );
  });
}
