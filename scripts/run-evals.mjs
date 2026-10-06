// `npm run evals` (Testing.md §7): real Claude API, so confirm and show the cost first. `--yes` skips the prompt.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

// ~69 turns (37 golden + 32 injection), ~10k input + ~600 output tokens each on Sonnet ($2/$10 per MTok),
// a few tool round-trips per turn, plus one web search.
console.log('Evals run ~69 real conversations against the Claude API.');
console.log(
  'Estimated cost: about $2-5 (Sonnet 5.5 pricing, Oct 2026). The OS side is faked: nothing on this PC is touched.',
);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Run them? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

const child = spawn(
  process.execPath,
  ['scripts/vitest-electron.mjs', 'run', '--config', 'vitest.evals.config.ts'],
  {
    stdio: 'inherit',
    env: process.env,
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
