import { expect, test } from '@playwright/test';
import { fakeScript, onboard } from './helpers';
import { launchApp } from './launch';

test('NPCs: hire from a template, see them in the office, tag them in the team chat', async () => {
  const { app, userDataDir } = await launchApp();
  const script = fakeScript(userDataDir, [
    {
      system: 'You are Maya, Marketing Head',
      steps: [{ text: 'Hi Sir! Tagline: **Less noise.**' }],
    },
    { system: 'You are Scout, Researcher', steps: [{ text: 'Found three competitors.' }] },
    {
      system: 'head of his NPC team',
      steps: [{ text: 'Decided: launch Friday.\n- @Maya: posts' }],
    },
  ]);
  await app.close();
  const relaunched = await launchApp({ JARVIS_FAKE_SCRIPT: script }, userDataDir);
  const page = await relaunched.app.firstWindow();
  await onboard(page);

  await page.getByRole('button', { name: 'NPCs', exact: true }).click();
  for (const role of ['Marketing Head', 'Researcher']) {
    await page.getByRole('button', { name: 'Hire NPC' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: new RegExp(role) }).click();
    await dialog.getByRole('button', { name: 'Hire', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  const office = page.getByRole('region', { name: 'Office' });
  await expect(office.getByRole('button', { name: /Maya/ })).toBeVisible();
  await expect(office.getByRole('button', { name: /Scout/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/npcs-office.png' });

  await page.getByRole('tab', { name: 'Team chat' }).click();
  const box = page.getByLabel('Message');
  await box.fill('@Maya give me a tagline');
  await box.press('Enter');
  await expect(page.getByText('Less noise.')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/npcs-chat.png' });

  await page.getByRole('tab', { name: 'Meeting room' }).click();
  await page.getByLabel('Meeting topic').fill('Launch plan');
  await page.getByRole('button', { name: 'Maya', exact: true }).click();
  await page.getByRole('button', { name: 'Scout', exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'Start meeting' }).click();
  await expect(page.getByText('Decided: launch Friday.')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/npcs-meeting.png' });

  await page.getByRole('tab', { name: 'Roster' }).click();
  await expect(page.getByText('Marketing Head').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/npcs-roster.png' });
  await relaunched.app.close();
});
