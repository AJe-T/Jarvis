import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeScript, onboard, openChat } from './helpers';
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
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  // Voice v2 (the default): no engine matrix, a voice check instead of the five-phrase training.
  await expect(page.getByRole('button', { name: 'Check my voice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up free on-device speech' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Keyword model: “Hey Jarvis” only/ })).toHaveCount(
    0,
  );
  // Classic: every engine is chosen by hand, as before.
  await page.getByLabel('Engine', { exact: true }).selectOption('classic');
  // ADR-011: on-device engines show what they need (downloads aren't started in tests).
  await page.getByRole('radio', { name: /Keyword model: “Hey Jarvis” only/ }).click();
  await expect(page.getByRole('button', { name: /^Download \(4 MB\)$/ })).toBeVisible();
  await page.getByRole('radio', { name: /^On this PC \(choose a model below\)/ }).click();
  await expect(page.getByRole('button', { name: /^Download \(254 MB\)$/ })).toBeVisible();
  // ADR-038: a phrase engine asks for its key and the small on-device voice detector.
  await page.getByRole('radio', { name: /^Groq Whisper \(free tier\)/ }).click();
  await expect(page.getByText('Groq API key')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Download \(2 MB\)$/ })).toBeVisible();
  await page.getByRole('radio', { name: /^Deepgram Nova-3/ }).click();
  // ADR-039 Voice Match: the voice model is downloaded on request first.
  await expect(page.getByRole('heading', { name: 'Your voice (Voice Match)' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Download \(102 MB\)$/ })).toBeVisible();
  await page.getByRole('radio', { name: /^Picovoice: “Jarvis” only/ }).click();
  // 2.24 (ADR-043): your own recorded "Hey Jarvis" is offered too.
  await expect(page.getByRole('radio', { name: /^Your own recorded “Hey Jarvis”/ })).toBeVisible();
  await page
    .getByRole('radio', { name: /^“Jarvis” or “Hey Jarvis” by speech recognition/ })
    .click();
  // 2.28 (ADR-044): the instant wake word, the saved default, comes first and needs its download.
  await page.getByRole('radio', { name: /^Best: instant “Hey Jarvis”/ }).click();
  await expect(page.getByRole('button', { name: /^Download \(18 MB\)$/ })).toBeVisible();
  await page.getByLabel('Engine', { exact: true }).selectOption('v2'); // back to the saved engine
  await page.getByRole('radio', { name: 'Press to talk' }).click();
  // 2.20: a new voice mode offers a clean restart; not now.
  await expect(page.getByText('Restart Jarvis now?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  // The engine radios above were only drafts and are back on the saved values: nothing to save.
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
  await expect(page.getByRole('radio', { name: 'Press to talk' })).toBeChecked();

  await page.getByRole('button', { name: 'Core', exact: true }).click();
  // Orb only on Core: the orb itself is the talk button.
  await page.getByRole('button', { name: 'Speak to Jarvis' }).click();
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
  await openChat(page);
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
