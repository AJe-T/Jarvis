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
    { JARVIS_FAKE_SCRIPT: script, JARVIS_FAKE_TRANSCRIPTS: 'what time is it in Tokyo' },
    dir,
  );
  const page = await app.firstWindow();
  await onboard(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Voice' }).click();
  // ADR-011: on-device engines show what they need (downloads aren't started in tests).
  await page.getByRole('radio', { name: /On-device: “Hey Jarvis”/ }).click();
  await expect(page.getByRole('button', { name: /^Download \(4 MB\)$/ })).toBeVisible();
  await page.getByRole('radio', { name: /Whisper \(on this PC\)/ }).click();
  await expect(page.getByRole('button', { name: /^Download \(254 MB\)$/ })).toBeVisible();
  await page.getByRole('radio', { name: /Deepgram \(cloud\)/ }).click();
  await page.getByRole('radio', { name: /^Picovoice: “Jarvis”/ }).click();
  await page.getByLabel(/Press to talk/).check();
  await expect(page.getByText('Voice: press to talk')).toBeVisible();

  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Talk to Jarvis' }).click();
  await expect(page.getByText('what time is it in Tokyo')).toBeVisible();
  await expect(page.getByText("It's half past nine, sir. Details on screen.")).toBeVisible();
  // Playback of the (silent) synthesized audio finishes and the orb returns to idle.
  await expect(page.getByRole('img', { name: 'Jarvis is idle' }).first()).toBeVisible({
    timeout: 10_000,
  });
  await app.close();
});

test('dictate a message: words stream into the box, nothing is sent until Send', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
  const script = fakeScript(dir, [
    { match: 'remind me to call mom', steps: [{ text: 'Noted, sir.' }] },
  ]);
  const { app } = await launchApp(
    { JARVIS_FAKE_SCRIPT: script, JARVIS_FAKE_TRANSCRIPTS: 'remind me to call mom' },
    dir,
  );
  const page = await app.firstWindow();
  await onboard(page);
  const box = page.getByLabel('Message Jarvis');
  await page.getByRole('button', { name: 'Dictate a message' }).click();
  await expect(box).toHaveValue('remind me to call mom');
  await page.getByRole('button', { name: 'Stop dictating' }).click();
  await expect(box).toHaveValue('remind me to call mom');
  await expect(page.getByText('Noted, sir.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Noted, sir.')).toBeVisible();
  await app.close();
});
