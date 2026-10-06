import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

// Testing.md §6.1: Electron configuration assertions.
test('main window is hardened', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // getLastWebPreferences exists at runtime but is missing from Electron's typings.
  type Prefs = { contextIsolation?: boolean; sandbox?: boolean; nodeIntegration?: boolean };
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) =>
      (
        w.webContents as unknown as { getLastWebPreferences(): Prefs | null }
      ).getLastWebPreferences(),
    ),
  );
  for (const p of prefs) {
    expect(p?.contextIsolation).toBe(true);
    expect(p?.sandbox).toBe(true);
    expect(p?.nodeIntegration).toBe(false);
  }

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(
    await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
  ).toBe('undefined');

  const opened = await page.evaluate(() => window.open('https://example.com') === null);
  expect(opened).toBe(true);
  await app.close();
});
