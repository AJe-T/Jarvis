import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('E1 vault skeleton + E5: memory browser lists notes and Forget moves one to .trash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const { app } = await launchApp({}, dir);
  const page = await app.firstWindow();
  await onboard(page);

  const vault = join(dir, 'home', 'documents', 'JarvisBrain');
  await expect.poll(() => existsSync(join(vault, 'Memory', 'About Sir.md'))).toBe(true);
  expect(readFileSync(join(vault, 'Memory', 'About Sir.md'), 'utf8')).toContain(
    'Sir works as Frontend developer.',
  );
  expect(existsSync(join(vault, 'README (Jarvis).md'))).toBe(true);

  await page.getByRole('button', { name: 'Memory' }).click();
  const tree = page.getByRole('complementary', { name: 'Memory notes' });
  await expect(tree.getByRole('button', { name: 'Preferences' })).toBeVisible();
  await tree.getByRole('button', { name: 'Preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Preferences', level: 2 })).toBeVisible();

  await page.getByRole('button', { name: 'Forget' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Forget' }).click();
  await expect(tree.getByRole('button', { name: 'Preferences' })).toBeHidden();
  expect(existsSync(join(vault, 'Memory', 'Preferences.md'))).toBe(false);
  expect(existsSync(join(vault, '.trash', 'Preferences.md'))).toBe(true);
  await app.close();
});
