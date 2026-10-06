import type { BrowserWindow } from 'electron';
import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Phase 7: manual backup, usage tab, mini orb round-trip', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Data & backups' }).click();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Backup saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(1);
  // ADR-010: switch the connection to the Claude subscription and back.
  await page.getByRole('button', { name: 'Models & budget' }).click();
  await page.getByRole('radio', { name: /My Claude subscription/ }).click();
  await expect(page.getByRole('radio', { name: /My Claude subscription/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page.getByText(/Signed in to Claude Code|not signed in|isn't installed/),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole('radio', { name: /Anthropic API key/ }).click();
  await expect(page.locator('#anthropic-label')).toBeVisible();
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.getByText(/^\d+\.\d+\.\d+/)).toBeVisible();

  await page.getByRole('button', { name: 'Activity' }).click();
  await page.getByRole('tab', { name: 'Usage' }).click();
  await expect(page.getByText('API spend this month')).toBeVisible();

  await page.getByRole('button', { name: 'Chat' }).click();
  const miniOpened = app.waitForEvent('window');
  const main = await app.browserWindow(page);
  await page.getByRole('button', { name: 'Mini orb' }).click();
  const mini = await miniOpened;
  await expect.poll(() => main.evaluate((w: BrowserWindow) => w.isVisible())).toBe(false);
  await mini.getByRole('button', { name: 'Open Jarvis' }).click();
  await expect.poll(() => main.evaluate((w: BrowserWindow) => w.isVisible())).toBe(true);
  await app.close();
});
