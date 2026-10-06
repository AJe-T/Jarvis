import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('E6: add a custom MCP server; it connects and lists its tools', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const { app } = await launchApp({}, dir);
  const page = await app.firstWindow();
  await onboard(page);

  await page.getByRole('button', { name: 'Connections' }).click();
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByRole('button', { name: /Custom server/ }).click();
  await page.getByLabel('Name (lowercase, used in tool names)').fill('fake');
  await page.getByLabel('Command', { exact: true }).fill('node');
  await page.getByLabel('Arguments').fill(`"${resolve('tests/fixtures/fake-mcp-server.mjs')}"`);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await expect(page.getByText('Connected · 4 tools')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Tools and permissions' }).click();
  await expect(page.getByLabel('Permission for echo')).toHaveValue('CONFIRM');
  await app.close();
});
