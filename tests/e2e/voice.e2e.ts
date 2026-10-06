import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeScript, onboard } from './helpers';
import { launchApp } from './launch';

test('voice turn: mic button → transcript → spoken reply plays → back to idle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const script = fakeScript(dir, [
    {
      match: 'what time',
      steps: [{ text: "<spoken>It's half past nine, sir.</spoken> Details on screen." }],
    },
  ]);
  const { app } = await launchApp(
    { JARVIS_FAKE_SCRIPT: script, JARVIS_FAKE_TRANSCRIPTS: 'what time is it' },
    dir,
  );
  const page = await app.firstWindow();
  await onboard(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Voice' }).click();
  await page.getByLabel(/Press to talk/).check();
  await expect(page.getByText('Voice: press to talk')).toBeVisible();

  await page.getByRole('button', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Talk to Jarvis' }).click();
  await expect(page.getByText('what time is it')).toBeVisible();
  await expect(page.getByText("It's half past nine, sir. Details on screen.")).toBeVisible();
  // Playback of the (silent) synthesized audio finishes and the orb returns to idle.
  await expect(page.getByRole('img', { name: 'Jarvis is idle' }).first()).toBeVisible({
    timeout: 10_000,
  });
  await app.close();
});
