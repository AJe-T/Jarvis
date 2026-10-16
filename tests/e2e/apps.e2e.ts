import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Apps: timers, scratchpad, terminal and browser beside the orb, help on every page', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Apps' })).toBeVisible();
  const card = (name: RegExp) =>
    page.getByRole('list', { name: 'Apps' }).getByRole('button', { name });

  // Help: the "?" beside the title explains the page.
  await page.getByRole('button', { name: 'Help: Apps' }).click();
  await expect(page.getByRole('dialog', { name: 'Apps' })).toContainText('How to use it');
  await page.screenshot({ path: 'test-results/32-apps-help.png' });
  await page.keyboard.press('Escape');

  // Timers open beside the orb: a quick countdown shows up with its live clock and can be cancelled.
  await card(/^Timers/).click();
  const timers = page.getByRole('region', { name: 'Timers' });
  await timers.getByRole('button', { name: '5 min', exact: true }).click();
  const timer = timers.getByRole('listitem').filter({ hasText: '5 min timer' });
  await expect(timer).toBeVisible();
  await expect(timer).toContainText(/0[45]:\d\d/);
  await page.screenshot({ path: 'test-results/30-apps-timers.png' });
  await timer.getByRole('button', { name: 'Cancel' }).click();
  await expect(timer).toBeHidden({ timeout: 7000 });

  // Scratchpad, from Core's "All apps", saves as you type.
  await page.getByRole('button', { name: 'All apps' }).click();
  await page
    .getByRole('dialog', { name: 'All apps' })
    .getByRole('button', { name: /^Scratchpad/ })
    .click();
  await page.getByLabel('Scratchpad text').fill('Call the plumber at 4');
  await expect(page.getByText(/^Saved ·/)).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'test-results/31-apps-scratchpad.png' });

  // Terminal opens beside the orb as its own page and runs a command.
  const terminalOpened = app.waitForEvent('window', (w) => w.url().endsWith('terminal.html'));
  await page.getByRole('button', { name: 'All apps' }).click();
  await page
    .getByRole('dialog', { name: 'All apps' })
    .getByRole('button', { name: /^Terminal/ })
    .click();
  await expect(page.getByRole('region', { name: 'Jarvis Terminal' })).toBeVisible();
  const term = await terminalOpened;
  await term.getByPlaceholder(/PowerShell command/).fill('Get-Date');
  await term.keyboard.press('Enter');
  await expect(term.locator('.entry .command')).toContainText('Get-Date');
  await term.getByPlaceholder(/PowerShell command/).fill('format C: /q');
  await term.keyboard.press('Enter');
  await expect(term.locator('.entry .output').last()).toContainText('Blocked');
  await page.screenshot({ path: 'test-results/33-terminal.png' });

  // Browser too, with its own address bar.
  const barOpened = app.waitForEvent('window', (w) => w.url().endsWith('browser-bar.html'));
  await page.getByRole('button', { name: 'All apps' }).click();
  await page
    .getByRole('dialog', { name: 'All apps' })
    .getByRole('button', { name: /^Browser/ })
    .click();
  await expect(page.getByRole('region', { name: 'Jarvis Browser' })).toBeVisible();
  const bar = await barOpened;
  await expect(bar.getByLabel('Address or search')).toBeVisible();
  await page.screenshot({ path: 'test-results/35-browser-docked.png' });
  await page
    .getByRole('region', { name: 'Jarvis Browser' })
    .getByRole('button', { name: 'Close panel' })
    .click();

  // Every settings page and section with help has its "?".
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: /^General/ })
    .click();
  await expect(page.getByRole('button', { name: 'Help: General' })).toBeVisible();
  await page.screenshot({ path: 'test-results/34-settings-general-orbs.png', fullPage: true });
  await app.close();
});
