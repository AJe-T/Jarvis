import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const TEST_KEY = 'sk-ant-test-0000000000000000000000000000';

/** Writes a FakeClaude script into the user-data dir and returns its path. */
export function fakeScript(dir: string, rules: unknown[]): string {
  const file = join(dir, 'fake-script.json');
  writeFileSync(file, JSON.stringify({ rules }));
  return file;
}

/** Completes the 5-step onboarding with a test key (E1). */
export async function onboard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Anthropic API key').fill(TEST_KEY);
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('✓ Key works')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder('Role, e.g. frontend developer').fill('Frontend developer');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByLabel('Message Jarvis')).toBeVisible();
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message Jarvis').fill(text);
  await page.keyboard.press('Enter');
}
