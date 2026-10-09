import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Tasks: quick add understands dates and tags; ticking a task completes it', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'All tasks' }).click();
  const box = page.getByLabel('Add a task to All tasks');
  await box.fill('Call mom tomorrow 6pm #family !1');
  await expect(page.getByText('Tomorrow', { exact: true })).toBeVisible();
  await box.press('Enter');
  await expect(page.getByText('Call mom', { exact: true })).toBeVisible();
  await expect(page.getByText('#family')).toBeVisible();
  await page.getByRole('button', { name: 'Complete "Call mom"' }).click();
  await page.getByRole('button', { name: 'Completed' }).click();
  await expect(page.getByText('Call mom', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'Done' })).toContainText('Call mom');
  await app.close();
});

test('Calendar: quick add puts an event on the week view and the editor opens it', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('radio', { name: 'Week' }).click();
  await page.getByLabel('Quick add: lunch with Sam fri 1-2pm').fill('Dentist tomorrow 4-5pm');
  await page.keyboard.press('Enter');
  const block = page.getByRole('button', { name: /Dentist, 16:00 to 17:00/ });
  await expect(block).toBeVisible();
  await block.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Dentist');
  await app.close();
});

test('Brain: every view renders', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  for (const [tab, name] of [
    ['3D orbs', /3D brain/],
    ['Clusters', /folder clusters/],
    ['Mind map', /Mind map/],
    ['Neural', /Brain graph/],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('img', { name })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Treemap' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Box size' })).toBeVisible();
  await app.close();
});
