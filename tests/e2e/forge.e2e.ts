import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Sidebar → Forge: the chat, the run history with its totals, and Forge’s own memory', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await page.getByRole('button', { name: 'Forge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forge' })).toBeVisible();

  // F9: the chat opens first; Sir's message is saved (in <vault>/Forge/Chats) and shown.
  await expect(page.getByText('Tell Forge what', { exact: false })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Message to Forge' });
  await box.fill('learn to convert currencies');
  await box.press('Enter');
  const log = page.getByRole('log', { name: 'Forge chat' });
  await expect(log.getByText('learn to convert currencies')).toBeVisible();

  // F7: the run history and its totals.
  await page.getByRole('tab', { name: 'Runs' }).click();
  await expect(page.getByText('No Forge runs yet.', { exact: false })).toBeVisible();
  const totals = page.getByRole('region', { name: 'Totals' });
  await expect(totals.getByText('Claude this month')).toBeVisible();
  await expect(totals.getByText('$0.00').first()).toBeVisible();

  // F10: Forge's memory, apart from Jarvis's; the chat file is there.
  await page.getByRole('tab', { name: 'Memory' }).click();
  await page.getByRole('button', { name: 'Chats' }).click();
  await expect(page.getByRole('list', { name: 'Forge/Chats' }).getByRole('button')).toHaveCount(1);
  await app.close();
});
