// Dev helper: launches the built app in test mode and saves screenshots of key screens.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from '@playwright/test';

const outDir = process.argv[2] ?? '.';
const dir = mkdtempSync(join(tmpdir(), 'jarvis-shots-'));
const script = join(dir, 'fake.json');
writeFileSync(script, JSON.stringify({ rules: [
  { match: 'hello', steps: [{ text: 'Good evening, sir. **All systems** are ready.\n\n| Item | Status |\n|---|---|\n| Brain | Online |\n| Memory | Online |\n\n```powershell\nGet-Process | Sort-Object WS -Descending\n```' }] },
] }));
const env = { ...process.env, JARVIS_TEST: '1', JARVIS_USER_DATA: dir, JARVIS_FAKE_SCRIPT: script };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1100, height: 760 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, '01-onboarding.png') });
const steps = process.argv.slice(3);
if (steps.includes('chat')) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Anthropic API key').fill('sk-ant-test-000000000000000000000000');
  await page.getByRole('button', { name: 'Save key' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '02-brain.png') });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.screenshot({ path: join(outDir, '03-safety.png') });
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '04-empty.png') });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '04-empty-dark.png') });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.getByLabel('Message Jarvis').fill('hello there');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, '05-chat.png') });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '06-settings.png') });
}
await app.close();
