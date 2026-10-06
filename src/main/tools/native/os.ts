import { execFile } from 'node:child_process';
import { ToolError } from '../../errors';
import { runPowerShell, runPowerShellJson, type PsOptions, type PsResult } from '../powershell';

/**
 * Everything native tools need from Windows/Electron, behind one seam so tests (and JARVIS_TEST E2E
 * runs) can substitute a recording fake.
 */
export interface OsAdapter {
  ps(script: string, opts?: PsOptions): Promise<PsResult>;
  psJson<T>(script: string, opts?: PsOptions): Promise<T>;
  run(
    file: string,
    args: string[],
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<void>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  trashItem(path: string): Promise<void>;
  notify(title: string, body: string): void;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
  mediaKey(key: 'play_pause' | 'next' | 'previous' | 'stop' | 'mute'): Promise<void>;
}

export interface ElectronBits {
  shell: {
    openPath(p: string): Promise<string>;
    openExternal(u: string): Promise<void>;
    trashItem(p: string): Promise<void>;
  };
  clipboard: { readText(): Promise<string>; writeText(t: string): Promise<void> };
  notify(title: string, body: string): void;
}

const VK: Record<Parameters<OsAdapter['mediaKey']>[0], number> = {
  play_pause: 0xb3,
  next: 0xb0,
  previous: 0xb1,
  stop: 0xb2,
  mute: 0xad,
};

export function createWindowsOs(e: ElectronBits): OsAdapter {
  return {
    ps: (script, opts) => runPowerShell(script, opts),
    psJson: <T>(script: string, opts?: PsOptions) => runPowerShellJson<T>(script, opts),
    run(file, args, opts = {}) {
      return new Promise((resolve, reject) => {
        execFile(
          file,
          args,
          { windowsHide: true, timeout: opts.timeoutMs ?? 15_000, signal: opts.signal },
          (err) => (err ? reject(new ToolError(`${file} failed: ${err.message}`)) : resolve()),
        );
      });
    },
    async openPath(path) {
      const error = await e.shell.openPath(path);
      if (error) throw new ToolError(`Windows could not open it: ${error}`);
    },
    openExternal: (url) => e.shell.openExternal(url),
    trashItem: (path) => e.shell.trashItem(path),
    notify: (title, body) => e.notify(title, body),
    clipboardRead: () => e.clipboard.readText(),
    clipboardWrite: (text) => e.clipboard.writeText(text),
    async mediaKey(key) {
      const script = `Add-Type -Name K -Namespace J -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);'
[J.K]::keybd_event(${VK[key]}, 0, 1, [UIntPtr]::Zero); [J.K]::keybd_event(${VK[key]}, 0, 3, [UIntPtr]::Zero)`;
      const r = await runPowerShell(script, { timeoutMs: 10_000 });
      if (r.exitCode !== 0) throw new ToolError(r.stderr || 'Media key failed.');
    },
  };
}

/** Records every OS call; used by unit tests and by E2E runs (JARVIS_TEST=1) so nothing real happens. */
export function createFakeOs(
  responses: Partial<{
    psJson: (script: string, opts?: PsOptions) => unknown;
    clipboard: string;
  }> = {},
) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  let clip = responses.clipboard ?? '';
  const os: OsAdapter & { calls: typeof calls } = {
    calls,
    async ps(script, opts) {
      calls.push({ op: 'ps', args: [script, opts?.params] });
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    },
    async psJson<T>(script: string, opts?: PsOptions): Promise<T> {
      calls.push({ op: 'psJson', args: [script, opts?.params] });
      return (responses.psJson?.(script, opts) ?? {}) as T;
    },
    async run(file, args) {
      calls.push({ op: 'run', args: [file, ...args] });
    },
    async openPath(path) {
      calls.push({ op: 'openPath', args: [path] });
    },
    async openExternal(url) {
      calls.push({ op: 'openExternal', args: [url] });
    },
    async trashItem(path) {
      calls.push({ op: 'trashItem', args: [path] });
    },
    notify(title, body) {
      calls.push({ op: 'notify', args: [title, body] });
    },
    clipboardRead: async () => clip,
    async clipboardWrite(text) {
      calls.push({ op: 'clipboardWrite', args: [text] });
      clip = text;
    },
    async mediaKey(key) {
      calls.push({ op: 'mediaKey', args: [key] });
    },
  };
  return os;
}
