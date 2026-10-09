import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeScript, onboard, sendMessage } from './helpers';
import { launchApp } from './launch';

test('Core panels: Jarvis shows a list beside the orb, the sidebar steps aside and comes back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const script = fakeScript(dir, [
    {
      match: 'pending tasks',
      steps: [
        {
          text: 'Here you are, sir.',
          tools: [
            {
              name: 'show_panel',
              input: {
                panel: { kind: 'list', title: 'Pending tasks', items: [{ text: 'Pay rent' }] },
              },
            },
          ],
        },
        { text: 'On screen.' },
      ],
    },
  ]);
  const { app } = await launchApp({ JARVIS_FAKE_SCRIPT: script }, dir);
  const page = await app.firstWindow();
  await onboard(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
  await sendMessage(page, 'what are my pending tasks');
  const panel = page.getByRole('region', { name: 'Pending tasks' });
  await expect(panel.getByText('Pay rent')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await panel.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  // The same panels open by hand; a pomodoro starts counting at once.
  await page.getByRole('button', { name: 'Show a panel' }).click();
  await page.getByRole('menuitem', { name: 'Pomodoro timer' }).click();
  await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
  await app.close();
});

test('Settings: accent colour previews, waits for Save, Discard reverts; Ctrl+B hides the sidebar', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
  const accent = (): Promise<string> =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--accent-600'));

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('radio', { name: 'Red' }).click();
  await expect(page.getByText('1 unsaved change')).toBeVisible();
  expect(await accent()).not.toBe('');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('1 unsaved change')).toBeHidden();
  expect(await accent()).toBe('');

  await page.getByRole('button', { name: 'Custom' }).click();
  await page.getByLabel('Hex colour').fill('#FFC400');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  // Saved: it survives leaving and coming back.
  await page.getByRole('button', { name: 'Automations' }).click();
  await expect(page.getByRole('heading', { name: 'Automations', level: 1 })).toBeVisible();
  expect(await accent()).not.toBe('');

  await page.keyboard.press('Control+b');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await app.close();
});
