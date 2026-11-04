import type { OsAdapter } from '../tools/native/os';
import { parseChord } from '../tools/native/ui-automation';

/**
 * Hold to talk (idea from Hex): Electron's global shortcuts only report a key going down, so while
 * Sir holds the dictation hotkey one PowerShell process polls the keys' state and returns when any
 * of them comes up. The key codes reach PowerShell as JSON in an environment variable.
 */

/** Longest hold before dictation ends anyway (DICTATION_MAX_MS ends the dictation too). */
const MAX_HOLD_SECONDS = 120;

export const PS_WAIT_RELEASE = `
if (-not ('JarvisKeyState' -as [type])) {
Add-Type -Name JarvisKeyState -Namespace J -MemberDefinition @'
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
'@
}
$deadline = (Get-Date).AddSeconds([int]$P.maxSeconds)
while ((Get-Date) -lt $deadline) {
  foreach ($k in $P.keys) {
    if (-not ([J.JarvisKeyState]::GetAsyncKeyState([int]$k) -band 0x8000)) { 'released'; exit 0 }
  }
  Start-Sleep -Milliseconds 40
}
'timeout'`;

/** Electron accelerator names → the names parseChord knows. */
const ALIASES: Record<string, string> = {
  commandorcontrol: 'ctrl',
  cmdorctrl: 'ctrl',
  command: 'ctrl',
  cmd: 'ctrl',
  option: 'alt',
  altgr: 'alt',
  super: 'win',
  meta: 'win',
  plus: '=',
};

/** "CommandOrControl+Alt+D" → virtual-key codes; throws on a key Windows can't poll by name. */
export function acceleratorKeys(accelerator: string): number[] {
  const names = accelerator
    .split('+')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .map((k) => ALIASES[k] ?? k);
  return parseChord(names.join('+'));
}

/** Resolves when Sir lets go of the hotkey (or after MAX_HOLD_SECONDS, or when the poll fails). */
export async function waitForRelease(
  os: Pick<OsAdapter, 'ps'>,
  accelerator: string,
  signal?: AbortSignal,
): Promise<void> {
  const keys = acceleratorKeys(accelerator);
  await os.ps(PS_WAIT_RELEASE, {
    params: { keys, maxSeconds: MAX_HOLD_SECONDS },
    timeoutMs: (MAX_HOLD_SECONDS + 15) * 1000,
    ...(signal ? { signal } : {}),
  });
}
