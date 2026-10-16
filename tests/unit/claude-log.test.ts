import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/claude-log.mjs');
const run = (dir: string, mode: string, input: object) =>
  execFileSync(process.execPath, [SCRIPT, mode], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });

describe('claude-log hook', () => {
  it('logs prompt + final reply (not tool chatter), redacts secrets, writes changes file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-log-'));
    const transcript = join(dir, 't.jsonl');
    writeFileSync(
      transcript,
      [
        { type: 'user', message: { content: 'old prompt' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'old reply' }] } },
        { type: 'user', message: { content: 'add weather' } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: '1' }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: '1' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Done, Sir.' }] } },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n'),
    );

    run(dir, 'prompt', { prompt: 'key sk-ant-abcdefghijklmnopqrstuvwxyz0123' });
    run(dir, 'stop', { transcript_path: transcript });

    const files = readdirSync(join(dir, 'conversations'));
    const log = readFileSync(
      join(
        dir,
        'conversations',
        files.find((f) => /^\d{4}-\d\d-\d\d\.md$/.test(f))!,
      ),
      'utf8',
    );
    expect(log).toContain('[REDACTED]');
    expect(log).not.toContain('sk-ant-');
    expect(log).toContain('Done, Sir.');
    expect(log).not.toContain('old reply');
    expect(files.some((f) => f.endsWith('-changes.md'))).toBe(true);
  });

  it('prefers last_assistant_message and never throws on bad input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-log-'));
    run(dir, 'stop', { last_assistant_message: 'direct reply' });
    const log = readdirSync(join(dir, 'conversations')).find((f) =>
      /^\d{4}-\d\d-\d\d\.md$/.test(f),
    )!;
    expect(readFileSync(join(dir, 'conversations', log), 'utf8')).toContain('direct reply');
    expect(() => run(dir, 'stop', { transcript_path: join(dir, 'missing.jsonl') })).not.toThrow();
  });
});
