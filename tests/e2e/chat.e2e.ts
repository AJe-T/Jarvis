import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeScript, onboard, sendMessage } from './helpers';
import { launchApp } from './launch';

test('E1 + E2 + E8 + E10: onboarding, streaming chat, masked key, history after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const script = fakeScript(dir, [
    {
      match: 'hello',
      steps: [{ text: 'Good evening, sir. All systems are ready.', chunkDelayMs: 40 }],
    },
  ]);

  const first = await launchApp({ JARVIS_FAKE_SCRIPT: script }, dir);
  const page = await first.app.firstWindow();
  await onboard(page);

  // E2: streaming caret while replying, then the final message.
  await sendMessage(page, 'hello there');
  await expect(page.locator('.stream-caret')).toBeVisible();
  await expect(page.getByText('Good evening, sir. All systems are ready.')).toBeVisible();
  await expect(page.locator('.stream-caret')).toHaveCount(0);

  // E8: the secret field shows only the last 4 characters; Replace offers a new input.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('secret-anthropic')).toHaveText('•••• 0000');
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Anthropic API key')).toHaveValue('');
  await first.app.close();

  // E10: conversations persist across restarts.
  const second = await launchApp({ JARVIS_FAKE_SCRIPT: script }, dir);
  const page2 = await second.app.firstWindow();
  await page2.getByRole('button', { name: 'Conversations' }).click();
  await page2.getByRole('button', { name: /Test conversation/ }).click();
  await expect(page2.getByText('hello there')).toBeVisible();
  await expect(page2.getByText('Good evening, sir. All systems are ready.')).toBeVisible();
  await second.app.close();
});
