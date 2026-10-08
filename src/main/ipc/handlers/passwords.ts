import { join } from 'node:path';
import { clipboard, powerMonitor } from 'electron';
import { createPasswordVault } from '../../passwords/password-vault';
import type { Services } from '../../services';
import { runPowerShell } from '../../tools/powershell';
import { handle } from '../handle';

/**
 * Puts text on the clipboard marked "don't keep" for Windows: excluded from clipboard history
 * (Win+V), cloud clipboard sync and clipboard monitors. The value travels as a parameter, never
 * in the script text.
 */
const PS_PRIVATE_COPY = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.DataObject
$d.SetText([string]$P.text)
$zero = [byte[]](0, 0, 0, 0)
$d.SetData('ExcludeClipboardContentFromMonitorProcessing', (New-Object System.IO.MemoryStream(,$zero)))
$d.SetData('CanIncludeInClipboardHistory', (New-Object System.IO.MemoryStream(,$zero)))
$d.SetData('CanUploadToCloudClipboard', (New-Object System.IO.MemoryStream(,$zero)))
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true, 10, 100)
'ok'`;

/**
 * Password manager channels (Security.md §16.6). The vault lives only here: it is not in Services,
 * so no tool, context provider, curator, channel (Telegram/WhatsApp/phone) or MCP server can reach it.
 * Audit entries record that something happened, never which entry or what it holds.
 */
export function registerPasswordHandlers(s: Services): void {
  const vault = createPasswordVault({
    file: join(s.userData, 'passwords.vault'),
    autoLockMinutes: () => s.settings.get('passwords.autoLockMinutes'),
    onLocked: () => s.emit('passwords:locked', {}),
  });
  // Lock with Windows (Win+L, sleep) and with the kill switch.
  if (!s.isTest) {
    powerMonitor.on('lock-screen', () => vault.lock());
    powerMonitor.on('suspend', () => vault.lock());
  }
  s.killSwitch.onKill(() => vault.lock());

  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyThenClear(text: string): Promise<number> {
    const seconds = s.settings.get('passwords.clipboardSeconds');
    const r = s.isTest
      ? null
      : await runPowerShell(PS_PRIVATE_COPY, { params: { text }, timeoutMs: 15_000 }).catch(
          () => null,
        );
    if (r?.stdout.trim() !== 'ok') await clipboard.writeText(text);
    clearTimeout(clearTimer);
    // Only wipe it if Sir hasn't copied something else since.
    clearTimer = setTimeout(
      () =>
        void clipboard
          .readText()
          .then((now) => (now === text ? clipboard.clear() : undefined))
          .catch(() => undefined),
      seconds * 1000,
    );
    return seconds;
  }

  handle('passwords:status', () => vault.status());
  handle('passwords:setup', async (req) => {
    await vault.setup(req.master);
    s.audit.append('user', 'passwords.setup', {});
    return { ok: true };
  });
  handle('passwords:unlock', async (req) => {
    try {
      await vault.unlock(req.master);
      s.audit.append('user', 'passwords.unlock', {});
    } catch (err) {
      s.audit.append('user', 'passwords.unlockFailed', {});
      throw err;
    }
    return { ok: true };
  });
  handle('passwords:lock', () => {
    vault.lock();
    return { ok: true };
  });
  handle('passwords:list', () => vault.list());
  handle('passwords:get', (req) => vault.get(req.id));
  handle('passwords:save', async (req) => {
    const saved = await vault.save(req);
    s.audit.append('user', 'passwords.save', {});
    return saved;
  });
  handle('passwords:delete', async (req) => {
    await vault.remove(req.id);
    s.audit.append('user', 'passwords.delete', {});
    return { ok: true };
  });
  handle('passwords:copy', async (req) => ({
    clearsInSeconds: await copyThenClear(vault.field(req.id, req.field)),
  }));
  handle('passwords:totp', (req) => vault.totp(req.id));
  handle('passwords:changeMaster', async (req) => {
    await vault.changeMaster(req.current, req.next);
    s.audit.append('user', 'passwords.changeMaster', {});
    return { ok: true };
  });
}
