import { expect, test } from '@playwright/test';
import { onboard } from './helpers';
import { launchApp } from './launch';

test('Compare AIs asks for a second AI; Settings → Brain adds a second key for a provider', async () => {
  const { app } = await launchApp();
  const page = await app.firstWindow();
  await onboard(page);
  // Integrations step 4: with only Jarvis's own connection there is nothing to compare yet.
  await page.getByRole('button', { name: 'Compare AIs', exact: true }).click();
  await expect(page.getByText('Set up a second AI first')).toBeVisible();

  // Step 3: a second OpenAI key, with its own key field and model list.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Models & AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connections and models' })).toBeVisible();
  await page.getByLabel('Add a connection').selectOption('openai');
  await page.getByLabel('Name', { exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Add key' }).click();
  await expect(page.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('OpenAI (ChatGPT models) API key').last()).toBeVisible();
  await page.getByLabel('Model id').fill('gpt-5-mini');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('gpt-5-mini')).toBeVisible();
  await expect(page.getByText('typed', { exact: true })).toBeVisible();
  await app.close();
});
