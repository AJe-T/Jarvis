import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeScript, onboard, sendMessage } from './helpers';
import { launchApp } from './launch';

test('E3 + E4: destructive confirmation lists files, Cancel focused, Ctrl+Enter approves; activity shows results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const downloads = join(dir, 'home', 'downloads');
  mkdirSync(downloads, { recursive: true });
  const files = ['old1.zip', 'old2.zip', 'old3.zip'].map((f) => join(downloads, f));
  for (const f of files) writeFileSync(f, 'x');
  const script = fakeScript(dir, [
    {
      match: 'clean downloads',
      steps: [
        {
          text: 'Moving three old archives, sir.',
          tools: [
            { name: 'get_datetime', input: {} },
            { name: 'delete_to_recycle_bin', input: { paths: files } },
          ],
        },
        { text: 'Done, sir.' },
      ],
    },
  ]);
  const { app } = await launchApp({ JARVIS_FAKE_SCRIPT: script }, dir);
  const page = await app.firstWindow();
  await onboard(page);
  await sendMessage(page, 'clean downloads');

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Move 3 items to the Recycle Bin?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog.getByText(/old2\.zip/)).toBeVisible();
  await page.getByRole('button', { name: 'Move to Recycle Bin' }).focus();
  await page.keyboard.press('Enter'); // Enter on the red button must not approve a destructive action
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Done, sir.')).toBeVisible();

  // E4: the activity drawer shows both tool cards with their status.
  const drawer = page.getByRole('complementary', { name: 'Activity' });
  // Below 1200px the drawer starts closed (Design-system.md §5.1).
  if (!(await drawer.isVisible()))
    await page.getByRole('button', { name: 'Show activity' }).click();
  await expect(drawer.getByText('Check the date and time')).toBeVisible();
  await expect(drawer.getByText('Move 3 items to the Recycle Bin')).toBeVisible();
  await expect(drawer.locator('text=/\\d+ ms/')).toHaveCount(2);
  await app.close();
});

test('E7: the kill switch stops a pending action and shows a toast', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const script = fakeScript(dir, [
    {
      match: 'shut down',
      steps: [{ tools: [{ name: 'shutdown_pc', input: {} }] }, { text: 'Understood.' }],
    },
  ]);
  const { app } = await launchApp({ JARVIS_FAKE_SCRIPT: script }, dir);
  const page = await app.firstWindow();
  await onboard(page);
  await sendMessage(page, 'shut down the PC');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  // The global hotkey calls the same kill switch as this IPC channel (hotkeys are disabled in test mode).
  await page.evaluate(() => window.jarvis.call['app:killSwitch']({}));
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByText('All activity stopped.')).toBeVisible();
  await expect(page.getByText('Declined').first()).toBeVisible();
  await app.close();
});
