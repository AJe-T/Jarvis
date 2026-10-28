import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Sidebar → Forge shows the run history, its totals and help', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await page.getByRole('button', { name: 'Forge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forge' })).toBeVisible();
  await expect(page.getByText('No Forge runs yet.', { exact: false })).toBeVisible();
  const totals = page.getByRole('region', { name: 'Totals' });
  await expect(totals.getByText('Claude this month')).toBeVisible();
  await expect(totals.getByText('$0.00').first()).toBeVisible();
  await app.close();
});
