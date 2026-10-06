// Release gate (Security.md §15): no secret may appear in the build, logs, vault or test artefacts.
// Usage: node scripts/secret-scan.mjs [dir ...]   (defaults: out, dist/win-unpacked, test-results; test sources hold fake keys on purpose)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PATTERNS = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['Notion token', /\b(secret|ntn)_[A-Za-z0-9]{40,}/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
// Exact values from .env (if present) catch keys with no recognisable prefix (Deepgram, Picovoice).
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.{12,})$/.exec(line.trim());
    if (m) PATTERNS.push([`.env ${m[1]}`, new RegExp(m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]);
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_BYTES = 20 * 1024 * 1024;
const dirs = process.argv.slice(2);
// E2E runs leave their userData (DB, logs, vault) in %TEMP%\jarvis-e2e-*.
const e2eData = readdirSync(tmpdir())
  .filter((n) => n.startsWith('jarvis-e2e-'))
  .map((n) => join(tmpdir(), n));
const roots = dirs.length ? dirs : ['out', 'dist/win-unpacked', 'test-results', ...e2eData];
const hits = [];

function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) if (!SKIP_DIRS.has(name)) walk(join(p, name));
    return;
  }
  if (st.size > MAX_BYTES) return;
  const text = readFileSync(p).toString('latin1');
  for (const [label, re] of PATTERNS) if (re.test(text)) hits.push(`${label}: ${p}`);
}

for (const r of roots) if (existsSync(r)) walk(r);
if (hits.length) {
  console.error(`Secret scan FAILED (${hits.length}):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`Secret scan passed (${roots.filter(existsSync).length} locations).`);
