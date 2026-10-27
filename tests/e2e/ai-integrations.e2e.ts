import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Compare AIs asks for a second AI; AI Router → API keys adds a named key with its model list', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  // Integrations step 4: with only Jarvis's own connection there is nothing to compare yet.
  await page.getByRole('button', { name: 'Compare AIs', exact: true }).click();
  await expect(page.getByText('Set up a second AI first')).toBeVisible();

  // Step 3 (2.34: in AI Router): the key itself is asked for, next to an optional name.
  await page.getByRole('button', { name: 'AI Router', exact: true }).click();
  await page.getByRole('tab', { name: 'API keys' }).click();
  await expect(page.getByRole('heading', { name: 'API keys and their models' })).toBeVisible();
  await page.getByLabel('Provider', { exact: true }).selectOption('openai');
  await page.getByLabel('API key', { exact: true }).fill('sk-test-0000000000000000000000000000');
  await page.getByLabel(/^Name/).fill('Work');
  await page.getByRole('button', { name: 'Save and load models' }).click();
  await expect(page.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('OpenAI (ChatGPT models) API key').last()).toBeVisible();
  await page.getByLabel('Model id').fill('gpt-5-mini');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('gpt-5-mini')).toBeVisible();
  await expect(page.getByText('typed', { exact: true })).toBeVisible();
  await app.close();
});
