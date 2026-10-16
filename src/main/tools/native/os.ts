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
  /** PNG of the primary display, at most maxWidth wide. */
  captureScreen(opts: { maxWidth: number }): Promise<Uint8Array>;
  /** Puts text into the focused app via the clipboard + Ctrl+V, then restores the clipboard. */
  pasteText(text: string): Promise<void>;
  /** The window in front (for dictation and the reply copilot); hwnd 0 when unknown. */
  foregroundWindow(): Promise<ForegroundWindow>;
  /** Brings the window with this exact title to the front; false if it isn't open. */
  focusWindow(title: string): Promise<boolean>;
  /** Brings this exact window (by handle) to the front; false if it has closed. */
  focusHandle(hwnd: number): Promise<boolean>;
}

export interface ForegroundWindow {
  title: string;
  process: string;
  hwnd: number;
  pid: number;
}

export interface ElectronBits {
  shell: {
    openPath(p: string): Promise<string>;
    openExternal(u: string): Promise<void>;
    trashItem(p: string): Promise<void>;
  };
  clipboard: { readText(): Promise<string>; writeText(t: string): Promise<void> };
  notify(title: string, body: string): void;
  captureScreen(maxWidth: number): Promise<Uint8Array>;
}

const VK: Record<Parameters<OsAdapter['mediaKey']>[0], number> = {
  play_pause: 0xb3,
  next: 0xb0,
  previous: 0xb1,
  stop: 0xb2,
  mute: 0xad,
};

const USER32 = `Add-Type -Name U -Namespace J -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);'`;
/** Ctrl down, V down, V up, Ctrl up. */
const PASTE_SCRIPT = `${USER32}
[J.U]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [J.U]::keybd_event(0x56,0,0,[UIntPtr]::Zero); [J.U]::keybd_event(0x56,0,2,[UIntPtr]::Zero); [J.U]::keybd_event(0x11,0,2,[UIntPtr]::Zero)`;
const FOREGROUND_SCRIPT = `${USER32}
$h = [J.U]::GetForegroundWindow(); $sb = New-Object System.Text.StringBuilder 512; [void][J.U]::GetWindowText($h, $sb, 512)
$procId = 0; [void][J.U]::GetWindowThreadProcessId($h, [ref]$procId); $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
@{ title = $sb.ToString(); process = $(if ($p) { $p.ProcessName } else { '' }); hwnd = $h.ToInt64(); pid = [int]$procId } | ConvertTo-Json -Compress`;
/** Restores and focuses one window by handle. Allowed because Jarvis (in front) starts this process. */
const FOCUS_HANDLE_SCRIPT = `Add-Type -Name F -Namespace J -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);'
$h = [System.IntPtr][long]$P.hwnd
if (-not [J.F]::IsWindow($h)) { "0"; exit }
if ([J.F]::IsIconic($h)) { [void][J.F]::ShowWindow($h, 9) }
$ok = [J.F]::SetForegroundWindow($h); Start-Sleep -Milliseconds 250
if ($ok) { "1" } else { "0" }`;

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
    captureScreen: ({ maxWidth }) => e.captureScreen(maxWidth),
    async pasteText(text) {
      const previous = await e.clipboard.readText().catch(() => '');
      await e.clipboard.writeText(text);
      const r = await runPowerShell(PASTE_SCRIPT, { timeoutMs: 10_000 });
      if (r.exitCode !== 0) throw new ToolError(r.stderr || 'Paste failed.');
      // Give the target app time to read the clipboard before putting Sir's clipboard back.
      setTimeout(() => void e.clipboard.writeText(previous).catch(() => undefined), 600);
    },
    async focusWindow(title) {
      const r = await runPowerShell(
        '$ok = (New-Object -ComObject WScript.Shell).AppActivate([string]$P.title); Start-Sleep -Milliseconds 300; if ($ok) { "1" } else { "0" }',
        { params: { title }, timeoutMs: 10_000 },
      );
      return r.exitCode === 0 && r.stdout.trim() === '1';
    },
    async foregroundWindow() {
      return runPowerShellJson<ForegroundWindow>(FOREGROUND_SCRIPT, { timeoutMs: 10_000 });
    },
    async focusHandle(hwnd) {
      const r = await runPowerShell(FOCUS_HANDLE_SCRIPT, { params: { hwnd }, timeoutMs: 10_000 });
      return r.exitCode === 0 && r.stdout.trim() === '1';
    },
    async mediaKey(key) {
      const script = `Add-Type -Name K -Namespace J -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);'
[J.K]::keybd_event(${VK[key]}, 0, 1, [UIntPtr]::Zero); [J.K]::keybd_event(${VK[key]}, 0, 3, [UIntPtr]::Zero)`;
      const r = await runPowerShell(script, { timeoutMs: 10_000 });
      if (r.exitCode !== 0) throw new ToolError(r.stderr || 'Media key failed.');
    },
  };
}

/** 1×1 transparent PNG. */
const FAKE_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
);

/** Records every OS call; used by unit tests and by E2E runs (JARVIS_TEST=1) so nothing real happens. */
export function createFakeOs(
  responses: Partial<{
    psJson: (script: string, opts?: PsOptions) => unknown;
    clipboard: string;
    foreground: ForegroundWindow;
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
    async captureScreen(opts) {
      calls.push({ op: 'captureScreen', args: [opts.maxWidth] });
      return FAKE_PNG;
    },
    async pasteText(text) {
      calls.push({ op: 'pasteText', args: [text] });
    },
    async focusWindow(title) {
      calls.push({ op: 'focusWindow', args: [title] });
      return true;
    },
    async focusHandle(hwnd) {
      calls.push({ op: 'focusHandle', args: [hwnd] });
      return true;
    },
    async foregroundWindow() {
      calls.push({ op: 'foregroundWindow', args: [] });
      return responses.foreground ?? { title: 'Notepad', process: 'notepad', hwnd: 4242, pid: 7 };
    },
  };
  return os;
}
