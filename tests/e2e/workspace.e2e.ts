import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Spaces: create a space and a page; it saves by itself and shows in the Brain', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await page.getByRole('button', { name: 'Spaces', exact: true }).click();
  await page.getByRole('button', { name: 'New space' }).last().click();
  await page.getByLabel('Space name').fill('Finance');
  await page.getByRole('button', { name: 'Create space' }).click();
  await expect(page.getByRole('button', { name: 'Space: Finance' })).toBeVisible();
  await page.getByRole('button', { name: 'New page' }).first().click();
  await page.getByRole('menuitem', { name: /Expense log/ }).click();
  const content = page.getByLabel('Page content');
  await expect(content).toHaveValue(/\| Date \| Item \|/);
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nRent 25000');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
    timeout: 5000,
  });
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  await expect(page.getByRole('img', { name: /Brain graph: \d+ notes/ })).toBeVisible();
  await expect(page.getByText('Spaces/Finance')).toBeVisible();
  await app.close();
});

test('Passwords: create the vault, save an entry, lock and unlock', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await page.getByRole('button', { name: 'Passwords', exact: true }).click();
  await page.getByLabel('Master password').fill('correct horse battery');
  await page.getByLabel('Type it again').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Bank');
  await page.getByLabel('Password', { exact: true }).fill('S3cret!pass');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible();
  await expect(page.getByText('S3cret!pass')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByText('S3cret!pass')).toBeVisible();
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByText('Passwords are locked')).toBeVisible();
  await page.getByLabel('Master password').fill('wrong one here');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong master password.');
  await page.getByLabel('Master password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: /Bank/ })).toBeVisible();
  await app.close();
});
