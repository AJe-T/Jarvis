// `npm run docs:reference`: regenerates docs/REFERENCE.md from the code (tools, settings, IPC, migrations).
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['scripts/vitest-electron.mjs', 'run', 'tests/unit/reference.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, DOCS_WRITE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 1));
