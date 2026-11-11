import { spawn } from 'node:child_process';
import { z } from 'zod';
import { redact } from '../security/redact';
import { PRIVATE_PROCESS, PRIVATE_TITLE } from '../tools/everyday/timeline';
import { psEnv } from '../tools/powershell';
import { defineTool, fail, ok, type Tool } from '../tools/types';

/**
 * Teach by showing (2.73): Sir says "watch me", does a task once, says "done". Meanwhile Jarvis
 * notes which window is in front and which control has the focus (its name and kind, as screen
 * readers see it), and afterwards turns that trail into a routine with save_routine.
 *
 * Security.md §16.23. It never records keys, typed text, field contents, the screen or the mouse.
 * Password fields are noted without their name, private windows without their title, and Jarvis's
 * own windows not at all. It only runs after Sir confirmed, for five minutes at most.
 */

export const MAX_WATCH_SECONDS = 300;
const MAX_STEPS = 120;
const TITLE_CHARS = 120;
const CONTROL_CHARS = 80;

/** One line the watcher process prints when the window in front or the focused control changes. */
const WatchEvent = z.object({
  process: z.string(),
  title: z.string(),
  pid: z.number(),
  hwnd: z.number(),
  control: z.string(),
  kind: z.string(),
  secret: z.boolean(),
});
export type WatchEvent = z.infer<typeof WatchEvent>;

export interface WatchStep {
  app: string;
  /** Empty for a private window. */
  window: string;
  /** The focused control's name; empty when it has none or is a password field. */
  control: string;
  kind: string;
}

/** Starts watching; `onEvent` for each change, `onEnd` when the process stops by itself. */
export type StartWatcher = (
  seconds: number,
  onEvent: (e: WatchEvent) => void,
  onEnd: () => void,
) => { stop(): void };

/** `$SECONDS` is replaced by a whole number of seconds; nothing else is put into the script. */
export const WATCH_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -Name W -Namespace J -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$deadline = (Get-Date).AddSeconds($SECONDS)
$last = ''
while ((Get-Date) -lt $deadline) {
  $h = [J.W]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][J.W]::GetWindowText($h, $sb, 512)
  $procId = 0
  [void][J.W]::GetWindowThreadProcessId($h, [ref]$procId)
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $name = ''; $kind = ''; $secret = $false
  try {
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($el) {
      $secret = [bool]$el.Current.IsPassword
      $kind = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', ''
      if (-not $secret) { $name = [string]$el.Current.Name }
    }
  } catch { }
  $ev = @{ process = $(if ($p) { $p.ProcessName } else { '' }); title = $sb.ToString(); pid = [int]$procId; hwnd = $h.ToInt64(); control = $name; kind = $kind; secret = $secret }
  $key = "$($ev.hwnd)|$($ev.title)|$($ev.control)|$($ev.kind)"
  if ($key -ne $last) { $last = $key; $ev | ConvertTo-Json -Compress }
  Start-Sleep -Milliseconds 700
}`;

/** The real watcher: one PowerShell process for the whole session (never a shell, no arguments from outside). */
export const startPowerShellWatcher: StartWatcher = (seconds, onEvent, onEnd) => {
  const whole = Math.min(MAX_WATCH_SECONDS, Math.max(1, Math.round(seconds)));
  const encoded = Buffer.from(
    `$ProgressPreference='SilentlyContinue'\n${WATCH_SCRIPT.replace('$SECONDS', String(whole))}`,
    'utf16le',
  ).toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded],
    {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: psEnv(process.env),
    },
  );
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const ev = WatchEvent.safeParse(JSON.parse(line));
        if (ev.success) onEvent(ev.data);
      } catch {
        // not a JSON line: ignored
      }
    }
  });
  child.on('close', onEnd);
  child.on('error', onEnd);
  return { stop: () => void child.kill() };
};

export type WatchMe = ReturnType<typeof createWatchMe>;

export function createWatchMe(d: {
  start: StartWatcher;
  /** Jarvis's own process id: his windows are not part of what Sir is showing. */
  ownPid: number;
  notify(message: string): void;
}) {
  let session: { stop(): void } | null = null;
  let steps: WatchStep[] = [];

  function onEvent(e: WatchEvent): void {
    const app = e.process.trim();
    if (!app || e.pid === d.ownPid || steps.length >= MAX_STEPS) return;
    const isPrivate = PRIVATE_PROCESS.test(app) || PRIVATE_TITLE.test(e.title);
    const step: WatchStep = {
      app,
      window: isPrivate ? '' : redact(e.title).trim().slice(0, TITLE_CHARS),
      control: isPrivate || e.secret ? '' : redact(e.control).trim().slice(0, CONTROL_CHARS),
      kind: e.secret ? 'password field' : e.kind,
    };
    const prev = steps.at(-1);
    const same =
      prev?.app === step.app &&
      prev.window === step.window &&
      prev.control === step.control &&
      prev.kind === step.kind;
    if (!same) steps = [...steps, step];
  }

  function stop(): WatchStep[] {
    session?.stop();
    session = null;
    const trail = steps;
    steps = [];
    return trail;
  }

  return {
    isWatching: (): boolean => session !== null,
    /** False when a session is already running. */
    begin(): boolean {
      if (session) return false;
      steps = [];
      session = d.start(MAX_WATCH_SECONDS, onEvent, () => {
        if (!session) return;
        session = null;
        d.notify(
          'Jarvis stopped watching (five minutes are up). Say "done" to turn it into a routine.',
        );
      });
      return true;
    },
    /** Stops (if still watching) and hands back what was seen; the trail is then forgotten. */
    end: stop,
    /** What was seen so far, kept (the time ran out before Sir said "done"). */
    seen: (): number => steps.length,
  };
}

/** "3. Code — services.ts - Jarvis: Edit "Message input"" */
export function describeTrail(trail: WatchStep[]): string {
  return trail
    .map((s, i) => {
      const where = s.window ? `${s.app} — ${s.window}` : `${s.app} (private window)`;
      const what = s.control ? `${s.kind} "${s.control}"` : s.kind;
      return `${i + 1}. ${where}${what ? `: ${what}` : ''}`;
    })
    .join('\n');
}

export function createWatchTools(watch: WatchMe): Tool[] {
  return [
    defineTool({
      name: 'watch_me',
      description:
        'Start watching what sir does so it can become a routine ("watch me", "let me show you how"). For up to five minutes Jarvis notes which window is in front and which control has the focus (names only): never keys, typed text, the screen or the mouse. Asks sir first. Afterwards call stop_watching, then offer save_routine. Not for something you can already do with your tools.',
      input: z.object({}).strict(),
      tier: 'CONFIRM',
      summarize: () => 'Watch what you do (window and control names, up to 5 minutes)',
      confirm: () => ({
        title: 'Let Jarvis watch what you do?',
        actionLabel: 'Start watching',
        details:
          'For up to five minutes Jarvis notes which window is in front and the name of the control you are on. He does not record keys, what you type, the screen or the mouse. Say "done" to stop.',
        detailsKind: 'text',
      }),
      run() {
        return Promise.resolve(
          watch.begin()
            ? ok(
                'Watching now, for five minutes at most. Tell sir to do the task and say "done" when he is finished.',
              )
            : fail('Already watching. Call stop_watching when sir says he is done.'),
        );
      },
    }),
    defineTool({
      name: 'stop_watching',
      description:
        'Stop watching (after watch_me, when sir says he is done) and get the trail: the windows he went through and the controls he focused, in order. Then propose routine steps from it with your own tools (open_app, focus_window, click_ui_element, open_url, ask_to_continue where he typed something) and offer save_routine.',
      input: z.object({}).strict(),
      tier: 'SAFE',
      untrustedOutput: true,
      summarize: () => 'Stop watching and read what you did',
      run() {
        const had = watch.isWatching() || watch.seen() > 0;
        const trail = watch.end();
        if (!had) return Promise.resolve(fail('Jarvis was not watching. Use watch_me first.'));
        if (trail.length === 0)
          return Promise.resolve(
            ok('Nothing was seen: sir stayed in Jarvis or did not switch windows.'),
          );
        return Promise.resolve({
          content: [{ type: 'text' as const, text: describeTrail(trail) }],
          untrustedSource: 'window and control names',
        });
      },
    }),
  ];
}
