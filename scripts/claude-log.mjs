// Claude Code hook: keeps conversations/ up to date with zero tokens spent.
//   prompt -> (UserPromptSubmit) append Sir's message to conversations/YYYY-MM-DD.md
//   stop   -> (Stop) append Claude's reply, then rebuild conversations/YYYY-MM-DD-changes.md from git
// Logs are gitignored and secrets are redacted. Claude never reads them unless asked (see RULES.md).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DIR = join(ROOT, 'conversations');
const SECRETS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/g,
  /\b(secret|ntn)_[A-Za-z0-9]{40,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

export const redact = (s) => SECRETS.reduce((t, re) => t.replace(re, '[REDACTED]'), s);

// Text Claude wrote since Sir's last real prompt (tool results are user entries too; skip those).
export function lastReply(jsonl) {
  const entries = jsonl
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  const isPrompt = (e) =>
    e.type === 'user' &&
    !(Array.isArray(e.message?.content) && e.message.content.some((c) => c.type === 'tool_result'));
  let start = 0;
  entries.forEach((e, i) => {
    if (isPrompt(e)) start = i + 1;
  });
  return entries
    .slice(start)
    .filter((e) => e.type === 'assistant' && Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content.filter((c) => c.type === 'text').map((c) => c.text))
    .join('\n\n')
    .trim();
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function writeChanges() {
  const commits = git([
    'log',
    `--since=${day}T00:00`,
    '--pretty=format:- `%h` %ad %s',
    '--date=format:%H:%M',
  ]);
  const pending = git(['status', '--short']);
  writeFileSync(
    join(DIR, `${day}-changes.md`),
    [
      `# Changes & new features: ${day}`,
      '',
      '_Auto-generated from git by scripts/claude-log.mjs. Do not edit._',
      '',
      '## Commits today',
      '',
      commits || '_none yet_',
      '',
      '## Uncommitted work',
      '',
      pending ? '```\n' + pending + '\n```' : '_clean_',
      '',
    ].join('\n'),
  );
}

function main() {
  const mode = process.argv[2];
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const log = join(DIR, `${day}.md`);
  if (!existsSync(log)) writeFileSync(log, `# Conversations: ${day}\n`);

  if (mode === 'prompt') {
    appendFileSync(log, `\n---\n\n## ${time} · Sir\n\n${redact(input.prompt ?? '')}\n`);
  } else if (mode === 'stop') {
    if (input.stop_hook_active) return;
    const reply =
      input.last_assistant_message ??
      (input.transcript_path && existsSync(input.transcript_path)
        ? lastReply(readFileSync(input.transcript_path, 'utf8'))
        : '');
    if (reply) appendFileSync(log, `\n## ${time} · Claude\n\n${redact(reply)}\n`);
    writeChanges();
  }
}

// A logging failure must never block a Claude turn: swallow, report on stderr, exit 0.
if (process.argv[1]?.endsWith('claude-log.mjs')) {
  try {
    main();
  } catch (e) {
    console.error(`claude-log: ${e.message}`);
  }
}
