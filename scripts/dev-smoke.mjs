// Dev helper: starts `electron-vite dev`, attaches over CDP, prints page text + console errors, exits.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'dev', '--', '--remote-debugging-port=9333'], { env, stdio: 'pipe' });
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});
const deadline = Date.now() + 60_000;
let browser;
while (!browser && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1500));
  browser = await chromium.connectOverCDP('http://127.0.0.1:9333').catch(() => undefined);
}
if (!browser) { console.error('could not attach'); child.kill(); process.exit(1); }
const page = browser.contexts()[0]?.pages()[0];
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.reload();
await new Promise((r) => setTimeout(r, Number(process.argv[2] ?? 4000)));
console.log('TEXT:', (await page.innerText('body')).slice(0, 500));
console.log('ERRORS:', errors);
await browser.close().catch(() => {});
spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
process.exit(0);
