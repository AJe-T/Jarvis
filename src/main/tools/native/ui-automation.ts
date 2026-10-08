import { z } from 'zod';
import { defineTool, fail, ok, type Tool } from '../types';
import { matchWindow, windows } from './apps';
import type { OsAdapter } from './os';

/**
 * Windows UI Automation tools (ideas from microsoft/UFO and Windows-Use; no code copied). Jarvis reads
 * an app's accessibility tree — buttons, text boxes, menus, list items — and acts on controls by name.
 * Free, offline, and works with every brain (API key, Claude plan or a local model), unlike screenshot
 * computer-use which needs the Anthropic computer tool. Parameters reach PowerShell as JSON in an
 * environment variable, never inside the script text (Security.md §5.2).
 */

const UIA_PRELUDE = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$proc = Get-Process -Id ([int]$P.pid) -ErrorAction Stop
if ($proc.MainWindowHandle -eq 0) { throw 'That app has no window open.' }
$root = $AE::FromHandle($proc.MainWindowHandle)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
function TypeOf($el) { $el.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', '' }
`;

/** Numbered list of the useful, visible controls in a window. */
export const PS_UIA_LIST = `${UIA_PRELUDE}
$out = New-Object System.Collections.ArrayList
$filter = [string]$P.filter
$keep = '^(Button|Edit|MenuItem|ListItem|TabItem|CheckBox|RadioButton|Hyperlink|ComboBox|TreeItem|Document|SplitButton|Slider|Spinner|DataItem|Text)$'
function Visit($el, $depth) {
  if ($out.Count -ge [int]$P.max -or $depth -gt 18) { return }
  $c = $el.Current
  $t = TypeOf $el
  if (-not $c.IsOffscreen -and ($c.Name -or $c.AutomationId) -and $t -match $keep -and ($t -ne 'Text' -or $P.withText)) {
    if (-not $filter -or ($c.Name -like "*$filter*") -or ($c.AutomationId -like "*$filter*")) {
      $v = ''
      try { $v = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}
      [void]$out.Add(@{ n = $c.Name; t = $t; id = $c.AutomationId; on = $c.IsEnabled; v = ([string]$v).Substring(0, [Math]::Min(80, ([string]$v).Length)) })
    }
  }
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null -and $out.Count -lt [int]$P.max) { Visit $child ($depth + 1); $child = $walker.GetNextSibling($child) }
}
Visit $root 0
@{ title = $root.Current.Name; items = @($out) } | ConvertTo-Json -Depth 4 -Compress`;

/** Finds the best control (exact name > starts with > contains; optional type / AutomationId) and acts on it. */
export const PS_UIA_ACT = `${UIA_PRELUDE}
if (-not ('JarvisMouse' -as [type])) {
Add-Type -Name JarvisMouse -Namespace J -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, System.UIntPtr e);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);
'@
}
$want = ([string]$P.name).ToLower()
$best = $null; $bestScore = 0
function Visit($el, $depth) {
  if ($depth -gt 18) { return }
  $c = $el.Current
  if (-not $c.IsOffscreen) {
    $n = ([string]$c.Name).ToLower()
    $score = 0
    if ($P.automationId -and $c.AutomationId -eq [string]$P.automationId) { $score = 4 }
    elseif ($want -and $n -eq $want) { $score = 3 }
    elseif ($want -and $n.StartsWith($want)) { $score = 2 }
    elseif ($want -and $n.Contains($want)) { $score = 1 }
    if ($score -gt 0 -and $P.controlType -and (TypeOf $el) -ne [string]$P.controlType) { $score = 0 }
    if ($score -gt $script:bestScore) { $script:best = $el; $script:bestScore = $score }
  }
  if ($script:bestScore -ge 3) { return }
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null) { Visit $child ($depth + 1); if ($script:bestScore -ge 3) { return }; $child = $walker.GetNextSibling($child) }
}
Visit $root 0
if ($best -eq $null) { @{ ok = $false; error = 'not found' } | ConvertTo-Json -Compress; exit 0 }
$c = $best.Current
$label = "$($c.Name) ($(TypeOf $best))"
if ($c.IsPassword -and $P.action -eq 'type') { @{ ok = $false; error = 'password field' } | ConvertTo-Json -Compress; exit 0 }
if ($P.risky -and $P.action -eq 'click' -and ([string]$c.Name -match [string]$P.risky)) { @{ ok = $false; error = 'risky'; label = $label } | ConvertTo-Json -Compress; exit 0 }
if (-not $c.IsEnabled) { @{ ok = $false; error = 'disabled'; label = $label } | ConvertTo-Json -Compress; exit 0 }
function Pattern($p) { try { return $best.GetCurrentPattern($p) } catch { return $null } }
$done = ''
switch ([string]$P.action) {
  'click' {
    $inv = Pattern ([System.Windows.Automation.InvokePattern]::Pattern)
    if ($inv) { $inv.Invoke(); $done = 'invoked'; break }
    $tog = Pattern ([System.Windows.Automation.TogglePattern]::Pattern)
    if ($tog) { $tog.Toggle(); $done = 'toggled'; break }
    $sel = Pattern ([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($sel) { $sel.Select(); $done = 'selected'; break }
    $exp = Pattern ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($exp) { $exp.Expand(); $done = 'expanded'; break }
    $r = $c.BoundingRectangle
    if ($r.Width -le 0) { @{ ok = $false; error = 'not clickable'; label = $label } | ConvertTo-Json -Compress; exit 0 }
    [void][J.JarvisMouse]::SetForegroundWindow($proc.MainWindowHandle); Start-Sleep -Milliseconds 150
    [void][J.JarvisMouse]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    [J.JarvisMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [J.JarvisMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    $done = 'clicked'
  }
  'type' {
    $val = Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($val -and -not $val.Current.IsReadOnly -and -not $P.append) { $val.SetValue([string]$P.text); $done = 'set' }
    else { [void][J.JarvisMouse]::SetForegroundWindow($proc.MainWindowHandle); $best.SetFocus(); $done = 'focused' }
  }
  'focus' { [void][J.JarvisMouse]::SetForegroundWindow($proc.MainWindowHandle); $best.SetFocus(); $done = 'focused' }
  'read' {
    $txt = ''
    $val = Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($val) { $txt = $val.Current.Value }
    $tp = Pattern ([System.Windows.Automation.TextPattern]::Pattern)
    if (-not $txt -and $tp) { $txt = $tp.DocumentRange.GetText(20000) }
    if (-not $txt) { $txt = $c.Name }
    $done = 'read'
    @{ ok = $true; done = $done; label = $label; text = $txt } | ConvertTo-Json -Compress; exit 0
  }
}
@{ ok = $true; done = $done; label = $label } | ConvertTo-Json -Compress`;

/** All the readable text of a window: values and TextPattern of documents, plus visible labels. */
export const PS_UIA_TEXT = `${UIA_PRELUDE}
$parts = New-Object System.Collections.ArrayList
$total = 0
function Visit($el, $depth) {
  if ($script:total -gt [int]$P.max -or $depth -gt 20) { return }
  $c = $el.Current
  if (-not $c.IsOffscreen) {
    $t = TypeOf $el
    $s = ''
    if ($t -eq 'Document' -or $t -eq 'Edit') {
      try { $s = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(20000) } catch {}
      if (-not $s) { try { $s = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {} }
    }
    if (-not $s -and ($t -eq 'Text' -or $t -eq 'ListItem' -or $t -eq 'DataItem' -or $t -eq 'Hyperlink')) { $s = $c.Name }
    if ($s -and -not $c.IsPassword) { [void]$parts.Add([string]$s); $script:total += ([string]$s).Length }
  }
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null) { Visit $child ($depth + 1); $child = $walker.GetNextSibling($child) }
}
Visit $root 0
@{ title = $root.Current.Name; text = ($parts -join "\`n") } | ConvertTo-Json -Compress`;

/** Process of the window in front and whether its focused control is a password box. */
export const PS_FOCUS_INFO = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if (-not ('JarvisFg' -as [type])) {
Add-Type -Name JarvisFg -Namespace J -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
'@
}
$procId = 0; [void][J.JarvisFg]::GetWindowThreadProcessId([J.JarvisFg]::GetForegroundWindow(), [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
$pw = $false
try { $pw = [System.Windows.Automation.AutomationElement]::FocusedElement.Current.IsPassword } catch {}
@{ process = $(if ($p) { $p.ProcessName } else { '' }); password = [bool]$pw } | ConvertTo-Json -Compress`;

export const PS_SEND_KEYS = `
if (-not ('JarvisKeys' -as [type])) {
Add-Type -Name JarvisKeys -Namespace J -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
'@
}
if ($P.pid) { $p = Get-Process -Id ([int]$P.pid) -ErrorAction Stop; [void][J.JarvisKeys]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 200 }
foreach ($k in $P.keys) { [J.JarvisKeys]::keybd_event([byte]$k, 0, 0, [UIntPtr]::Zero) }
[array]::Reverse($P.keys)
foreach ($k in $P.keys) { [J.JarvisKeys]::keybd_event([byte]$k, 0, 2, [UIntPtr]::Zero) }
'ok'`;

const VK: Record<string, number> = {
  ctrl: 0x11,
  control: 0x11,
  shift: 0x10,
  alt: 0x12,
  win: 0x5b,
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  esc: 0x1b,
  escape: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  space: 0x20,
  printscreen: 0x2c,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  ';': 0xba,
  '-': 0xbd,
  '=': 0xbb,
  '[': 0xdb,
  ']': 0xdd,
};

/** "ctrl+shift+s" → virtual-key codes; throws on unknown names. */
export function parseChord(chord: string): number[] {
  return chord
    .toLowerCase()
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      if (k in VK) return VK[k] as number;
      if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
      const f = /^f([1-9]|1[0-2])$/.exec(k);
      if (f) return 0x6f + Number(f[1]);
      throw new Error(`Unknown key "${k}".`);
    });
}

/**
 * Chords that hand control to something Jarvis must not drive (Security.md §5.3), judged on the set
 * of keys (order-free, so "r+win" is the same as "win+r"). Win+R/X/L, Ctrl+Alt+Del and Ctrl+Shift+Esc
 * are blocked; any other Win chord, closing chords, permanent deletes and Enter ask first.
 */
export function chordTier(chord: string): 'SAFE' | 'CONFIRM' | 'BLOCKED' {
  let codes: number[];
  try {
    codes = parseChord(chord);
  } catch {
    return 'SAFE'; // run() refuses unknown keys anyway
  }
  const has = (...vk: number[]): boolean => vk.every((v) => codes.includes(v));
  const WIN = 0x5b;
  const [CTRL, ALT, SHIFT, DEL, ESC, ENTER, F4, W] = [
    0x11, 0x12, 0x10, 0x2e, 0x1b, 0x0d, 0x73, 0x57,
  ];
  if (has(WIN, 0x52) || has(WIN, 0x58) || has(WIN, 0x4c)) return 'BLOCKED';
  if (has(CTRL, ALT, DEL) || has(CTRL, SHIFT, ESC)) return 'BLOCKED';
  if (has(WIN) || has(ALT, F4) || has(CTRL, W) || has(SHIFT, DEL) || has(ENTER)) return 'CONFIRM';
  return 'SAFE';
}

/** Jarvis's own windows (packaged "Jarvis", dev "electron") are never driven or read by these tools. */
const SELF = /^(jarvis|electron)$/i;

/** Buttons whose label means sending, paying, deleting or agreeing need Sir's approval. */
const RISKY =
  /\b(send|delete|remove|erase|uninstall|format|pay|buy|purchase|order|checkout|transfer|submit|post|publish|sign|accept|agree|confirm|install|reset|discard|unsubscribe|block|report)\b/i;
/** Label + AutomationId as words ("SendButton", "btn_send" → "Send Button", "btn send"). */
const riskText = (i: { name: string; automationId?: string | undefined }): string =>
  `${i.name} ${i.automationId ?? ''}`.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
const DESTRUCTIVE = /\b(delete|remove|erase|uninstall|format|reset|discard)\b/i;

const target = {
  window: z
    .string()
    .min(1)
    .max(100)
    .describe('App or window name, e.g. "Notepad", "Spotify", "Settings"'),
  name: z
    .string()
    .max(200)
    .default('')
    .describe('Visible label of the control (from list_ui_elements)'),
  controlType: z.string().max(30).optional().describe('e.g. Button, Edit, MenuItem, ListItem'),
  automationId: z.string().max(200).optional(),
};

interface ActResult {
  ok: boolean;
  error?: string;
  done?: string;
  label?: string;
  text?: string;
}

function notFound(r: ActResult, name: string): string {
  if (r.error === 'password field')
    return 'That is a password field. Jarvis never types passwords; sir must type it himself.';
  if (r.error === 'disabled') return `${r.label ?? name} is disabled right now.`;
  return `No control matching "${name}" is visible. Use list_ui_elements to see what is there.`;
}

export function createUiAutomationTools(osa: OsAdapter): Tool[] {
  // Never Jarvis itself: its windows show revealed passwords and its own Approve buttons.
  const pidFor = async (window: string, signal: AbortSignal): Promise<number | null> =>
    matchWindow(
      (await windows(osa, signal)).filter((w) => !SELF.test(w.ProcessName) && w.Id !== process.pid),
      window,
    )?.Id ?? null;
  /** Keys and pasted text go to the window in front: refuse when that is Jarvis or a password box. */
  const frontIsSafe = async (signal: AbortSignal): Promise<string | null> => {
    const r = await osa.psJson<{ process: string; password: boolean }>(PS_FOCUS_INFO, {
      signal,
      timeoutMs: 15_000,
    });
    if (SELF.test(r.process ?? ''))
      return 'The window in front is Jarvis itself; name the app to use (window: …).';
    if (r.password) return 'The focused field is a password box. Jarvis never types passwords.';
    return null;
  };

  return [
    defineTool({
      name: 'list_ui_elements',
      description:
        "See the controls inside an app window (buttons, text boxes, menus, tabs, list items) via Windows UI Automation — no screenshot needed. Use before click_ui_element / set_ui_text. Optional filter narrows by label. Works for most apps (File Explorer, Settings, Office, Notepad, Spotify, browsers' toolbars).",
      input: z.object({
        window: target.window,
        filter: z.string().max(100).optional(),
        includeText: z.boolean().default(false).describe('Also list static text labels'),
        max: z.number().int().min(10).max(300).default(120),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      timeoutMs: 30_000,
      summarize: (i) => `Look at the controls in ${i.window}`,
      async run(i, ctx) {
        const pid = await pidFor(i.window, ctx.signal);
        if (!pid)
          return fail(`No open window matches "${i.window}". Use list_open_windows or open_app.`);
        const r = await osa.psJson<{
          title: string;
          items: Array<{ n: string; t: string; id: string; on: boolean; v: string }>;
        }>(PS_UIA_LIST, {
          params: { pid, filter: i.filter ?? '', max: i.max, withText: i.includeText },
          signal: ctx.signal,
          timeoutMs: 25_000,
        });
        const items = Array.isArray(r.items) ? r.items : [];
        if (!items.length)
          return ok(
            `${r.title}: no labelled controls found${i.filter ? ` for "${i.filter}"` : ''}.`,
          );
        return ok(
          `${r.title}\n${items
            .map(
              (x, n) =>
                `${n + 1}. ${x.t} "${x.n}"${x.id ? ` id=${x.id}` : ''}${x.on ? '' : ' (disabled)'}${x.v ? ` value="${x.v}"` : ''}`,
            )
            .join('\n')}`,
        );
      },
    }),
    defineTool({
      name: 'click_ui_element',
      description:
        'Click (invoke, toggle, select or expand) a control in an app window by its visible label, e.g. window "Settings", name "Bluetooth & devices". Get labels from list_ui_elements. Buttons that send, pay, delete or agree ask sir first.',
      input: z.object(target),
      tier: (i) => (RISKY.test(riskText(i)) ? 'CONFIRM' : 'SAFE'),
      destructive: (i) => DESTRUCTIVE.test(riskText(i)),
      externalFacing: true,
      timeoutMs: 30_000,
      summarize: (i) => `Click "${i.name || i.automationId}" in ${i.window}`,
      async run(i, ctx) {
        const pid = await pidFor(i.window, ctx.signal);
        if (!pid) return fail(`No open window matches "${i.window}".`);
        const r = await osa.psJson<ActResult>(PS_UIA_ACT, {
          params: {
            pid,
            action: 'click',
            // Fuzzy matching could land on "Send mail" for "Mail": a risky control needs a risky name.
            risky: RISKY.test(riskText(i)) ? '' : RISKY.source,
            name: i.name,
            controlType: i.controlType ?? '',
            automationId: i.automationId ?? '',
          },
          signal: ctx.signal,
          timeoutMs: 25_000,
        });
        if (r.error === 'risky')
          return fail(
            `The matching control is "${r.label}". Ask again with that exact name so sir can approve it.`,
          );
        return r.ok ? ok(`Done: ${r.done} ${r.label}.`) : fail(notFound(r, i.name));
      },
    }),
    defineTool({
      name: 'set_ui_text',
      description:
        'Type text into a text box in an app window, found by its label (e.g. window "Notepad", name "Text editor"; a search box). Replaces the content unless append is true. submit presses Enter afterwards (asks sir first). Never for passwords, codes or card numbers.',
      input: z.object({
        ...target,
        text: z.string().max(10_000),
        append: z.boolean().default(false),
        submit: z.boolean().default(false),
      }),
      tier: (i) => (i.submit ? 'CONFIRM' : 'SAFE'),
      externalFacing: true,
      timeoutMs: 30_000,
      guards: (i) => ({ text: [i.text] }),
      summarize: (i) =>
        `Type into "${i.name || i.automationId}" in ${i.window}${i.submit ? ' and press Enter' : ''}`,
      confirm: (i) => ({
        title: `Type and submit in ${i.window}?`,
        actionLabel: 'Type and submit',
        details: i.text,
        detailsKind: 'text',
      }),
      async run(i, ctx) {
        const pid = await pidFor(i.window, ctx.signal);
        if (!pid) return fail(`No open window matches "${i.window}".`);
        const r = await osa.psJson<ActResult>(PS_UIA_ACT, {
          params: {
            pid,
            action: 'type',
            name: i.name,
            controlType: i.controlType ?? '',
            automationId: i.automationId ?? '',
            text: i.text,
            append: i.append,
          },
          signal: ctx.signal,
          timeoutMs: 25_000,
        });
        if (!r.ok) return fail(notFound(r, i.name));
        // No writable value: the control has focus now, so paste the text like a person would.
        if (r.done === 'focused') await osa.pasteText(i.text);
        if (i.submit)
          await osa.ps(PS_SEND_KEYS, {
            params: { pid, keys: [0x0d] },
            signal: ctx.signal,
            timeoutMs: 10_000,
          });
        return ok(`Typed into ${r.label}${i.submit ? ' and pressed Enter' : ''}.`);
      },
    }),
    defineTool({
      name: 'read_window_text',
      description:
        "Read the text shown in an app window (document contents, chat messages, labels) through UI Automation. Cheaper and more exact than a screenshot. Use for 'what does this window say', reading a Notepad file, a chat, an error dialog. Optional name reads one control.",
      input: z.object({
        window: target.window,
        name: z.string().max(200).optional(),
        maxChars: z.number().int().min(500).max(30_000).default(8000),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      timeoutMs: 30_000,
      summarize: (i) => `Read the text in ${i.window}`,
      async run(i, ctx) {
        const pid = await pidFor(i.window, ctx.signal);
        if (!pid) return fail(`No open window matches "${i.window}".`);
        if (i.name) {
          const r = await osa.psJson<ActResult>(PS_UIA_ACT, {
            params: { pid, action: 'read', name: i.name, controlType: '', automationId: '' },
            signal: ctx.signal,
            timeoutMs: 25_000,
          });
          return r.ok ? ok((r.text ?? '').slice(0, i.maxChars)) : fail(notFound(r, i.name));
        }
        const r = await osa.psJson<{ title: string; text: string }>(PS_UIA_TEXT, {
          params: { pid, max: i.maxChars },
          signal: ctx.signal,
          timeoutMs: 25_000,
        });
        return ok(`${r.title}\n\n${(r.text || '(no readable text)').slice(0, i.maxChars)}`);
      },
    }),
    defineTool({
      name: 'press_keys',
      description:
        'Press a keyboard shortcut in an app, e.g. "ctrl+s", "ctrl+shift+n", "alt+tab", "f5", "enter", "ctrl+l". Give window to bring that app to the front first; otherwise it goes to the window in front. Closing shortcuts ask sir first; Win+R and Ctrl+Alt+Del are never allowed.',
      input: z.object({
        keys: z.string().min(1).max(40),
        window: z.string().max(100).optional(),
        times: z.number().int().min(1).max(20).default(1),
      }),
      tier: (i) => chordTier(i.keys),
      destructive: (i) => chordTier(i.keys) === 'CONFIRM',
      summarize: (i) =>
        `Press ${i.keys}${i.times > 1 ? ` ×${i.times}` : ''}${i.window ? ` in ${i.window}` : ''}`,
      async run(i, ctx) {
        let codes: number[];
        try {
          codes = parseChord(i.keys);
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        const pid = i.window ? await pidFor(i.window, ctx.signal) : null;
        if (i.window && !pid) return fail(`No open window matches "${i.window}".`);
        if (!pid) {
          const why = await frontIsSafe(ctx.signal);
          if (why) return fail(why);
        }
        for (let n = 0; n < i.times; n++)
          await osa.ps(PS_SEND_KEYS, {
            params: { pid: n === 0 ? pid : null, keys: codes },
            signal: ctx.signal,
            timeoutMs: 10_000,
          });
        return ok(`Pressed ${i.keys}${i.times > 1 ? ` ${i.times} times` : ''}.`);
      },
    }),
    defineTool({
      name: 'type_text',
      description:
        'Type text into whatever has keyboard focus (after focus_window or click_ui_element), like pasting. Does not press Enter. Never for passwords, one-time codes or card numbers.',
      input: z.object({ text: z.string().min(1).max(10_000) }),
      tier: 'SAFE',
      externalFacing: true,
      guards: (i) => ({ text: [i.text] }),
      summarize: (i) => `Type "${i.text.slice(0, 40)}${i.text.length > 40 ? '…' : ''}"`,
      async run(i, ctx) {
        const why = await frontIsSafe(ctx.signal);
        if (why) return fail(why);
        await osa.pasteText(i.text);
        return ok('Typed.');
      },
    }),
  ];
}
