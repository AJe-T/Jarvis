import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeScript, onboard, sendMessage } from './helpers';
import { launchApp } from './launch';

test('Ctrl+K jumps to a screen and finds a past chat; the latest reply offers send-to chips', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const script = fakeScript(dir, [
    { match: 'dentist', steps: [{ text: 'The dentist is free on Friday at 4 pm.' }] },
  ]);
  const { app } = await launchApp({ JARVIS_FAKE_SCRIPT: script }, dir);
  const page = await app.firstWindow();
  await onboard(page);

  // v2.64 chips: tasks and Spaces always, the calendar because the reply names a time.
  await sendMessage(page, 'when is the dentist free');
  const chips = page.getByLabel('Follow-ups');
  await expect(chips.getByRole('button', { name: 'Add to tasks' })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'Save to Space' })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'Add to calendar' })).toBeVisible();

  // The palette opens as a menu and jumps to a screen.
  const box = page.getByRole('combobox', { name: /Search screens/ });
  await page.keyboard.press('Control+k');
  await expect(box).toBeVisible();
  await expect(page.getByRole('option', { name: 'Actions: New chat' })).toBeVisible();
  await box.fill('tasks');
  await expect(page.getByRole('option', { name: 'Go to: Tasks' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(box).toBeHidden();
  await expect(page.getByRole('button', { name: 'All tasks' })).toBeVisible();

  // It finds the chat by what was said in it and opens it.
  await page.keyboard.press('Control+k');
  await box.fill('dentist');
  const hit = page.getByRole('option', { name: /^Chats: / }).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.getByRole('region', { name: 'Jarvis core' })).toBeVisible();
  await expect(page.getByText('The dentist is free on Friday at 4 pm.').first()).toBeVisible();

  // Esc closes it without going anywhere.
  await page.keyboard.press('Control+k');
  await expect(box).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await app.close();
});
