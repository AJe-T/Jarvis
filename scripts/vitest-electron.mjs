// Runs Vitest on Electron's bundled Node (ADR-009): its node:sqlite includes FTS5, system Node 22's does not.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron'); // resolves to the electron.exe path when required from plain Node
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const child = spawn(electron, [vitest, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 1));
