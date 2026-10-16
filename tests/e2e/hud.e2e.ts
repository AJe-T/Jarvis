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
      match: 'draw',
      steps: [
        {
          text: 'Here it is.\n\n```artifact-svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- title: Box --><rect width="10" height="10"/></svg>\n```',
        },
      ],
    },
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
  // The same panels open by hand from "All apps" (the Apps page's list); a pomodoro counts at once.
  const allApps = async (): Promise<void> => {
    await page.getByRole('button', { name: 'All apps' }).click();
    await expect(page.getByRole('dialog', { name: 'All apps' })).toBeVisible();
  };
  await allApps();
  await page
    .getByRole('dialog', { name: 'All apps' })
    .getByRole('button', { name: /^Pomodoro/ })
    .click();
  await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
  await allApps();
  await page
    .getByRole('dialog', { name: 'All apps' })
    .getByRole('button', { name: /^Calculator/ })
    .click();
  await page.getByRole('textbox', { name: 'Sum' }).fill('2 + 3 × 4');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Sum' })).toHaveValue('14');
  // Pressing the open app again closes it.
  await allApps();
  await page
    .getByRole('dialog', { name: 'All apps' })
    .getByRole('button', { name: /^Calculator/ })
    .click();
  await expect(page.getByRole('region', { name: 'Calculator' })).toBeHidden();
  // "What is 2+2?" opens the calculator with the answer, with no model call.
  await sendMessage(page, 'What is 2+2?');
  await expect(page.getByRole('textbox', { name: 'Sum' })).toHaveValue('2+2');
  await expect(page.getByText('= 4')).toBeVisible();
  // No status bar any more (the window has no Windows title bar either).
  await expect(page.getByRole('contentinfo', { name: 'Status' })).toHaveCount(0);
  // A reply with a drawing shows it beside the orb by itself.
  await sendMessage(page, 'draw me a box');
  await expect(page.getByRole('region', { name: 'Drawing' })).toBeVisible();
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

test('Conversation log: long paths wrap, and dragging its edge widens it (remembered)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const long =
    'The copy is at C:/Users/TEJA/Videos/' + 'very-long-folder-name-'.repeat(12) + 'end.';
  const script = fakeScript(dir, [{ match: 'where', steps: [{ text: long }] }]);
  const { app } = await launchApp({ JARVIS_FAKE_SCRIPT: script }, dir);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1500, height: 820 });
  await onboard(page);
  await sendMessage(page, 'where is it');
  const log = page.getByRole('complementary', { name: 'Conversation' });
  await expect(log.getByText('end.', { exact: false })).toBeVisible();
  // Nothing scrolls sideways.
  expect(
    await log.evaluate((a) =>
      Array.from(a.querySelectorAll('*')).some(
        (e: Element) =>
          e.scrollWidth > e.clientWidth + 1 &&
          getComputedStyle(e).overflowX !== 'visible' &&
          e.tagName !== 'PRE' &&
          e.tagName !== 'TEXTAREA',
      ),
    ),
  ).toBe(false);
  const before = (await log.boundingBox())!.width;
  const edge = page.getByRole('separator', { name: 'Resize conversation log' });
  const b = (await edge.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x - 250, b.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = (await log.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 200);
  // Keyboard: → narrows it again.
  await edge.focus();
  await page.keyboard.press('ArrowRight');
  expect((await log.boundingBox())!.width).toBeLessThan(after);
  await app.close();
});
