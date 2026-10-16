import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCliBrains, type runExe } from './cli-brains';

const signal = new AbortController().signal;

function brains(run: typeof runExe, installed = true) {
  return createCliBrains({
    workDir: mkdtempSync(join(tmpdir(), 'cli-brains-')),
    env: { APPDATA: 'C:\\AppData', LOCALAPPDATA: 'C:\\Local' },
    exists: () => installed,
    run,
  });
}

describe('subscription brains (official apps, answers only)', () => {
  it("runs Codex read-only with Sir's Codex config ignored, prompt on stdin, answer from -o", async () => {
    const seen: Array<{ exe: string; args: string[]; stdin: string }> = [];
    const b = brains(async (exe, args, opts) => {
      seen.push({ exe, args, stdin: opts.stdin });
      writeFileSync(args[args.indexOf('-o') + 1] as string, 'Paris.');
      return { code: 0, stdout: '', stderr: '' };
    });
    expect(await b.chatgpt.run('Capital of France?', signal)).toBe('Paris.');
    const call = seen[0];
    expect(call?.exe).toMatch(/codex\.exe$/);
    expect(call?.args).toEqual(
      expect.arrayContaining(['exec', '--sandbox', 'read-only', '--ignore-user-config', '-']),
    );
    expect(call?.args).not.toContain('danger-full-access');
    expect(call?.stdin).toBe('Capital of France?');
  });

  it('explains a missing login instead of failing silently', async () => {
    const why = (p: Promise<string>): Promise<string> =>
      p.then(
        () => '',
        (e: unknown) => (e as { userMessage?: string }).userMessage ?? '',
      );
    const codex = brains(async () => ({ code: 1, stdout: '', stderr: 'Error: not logged in' }));
    expect(await why(codex.chatgpt.run('hi', signal))).toMatch(/codex login/);
    // Antigravity prints nothing (exit 0) when signed out.
    const agy = brains(async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(await why(agy.antigravity.run('hi', signal))).toMatch(/sign in/);
  });

  it('runs Antigravity without auto-approval and returns its answer', async () => {
    let args: string[] = [];
    const b = brains(async (_exe, a) => {
      args = a;
      return { code: 0, stdout: 'Hello, sir.\n', stderr: '' };
    });
    expect(await b.antigravity.run('Say hello', signal)).toBe('Hello, sir.');
    expect(args).toEqual(['--print', 'Request:\nSay hello']);
  });

  it('is not offered when the app is not installed', () => {
    const b = brains(async () => ({ code: 0, stdout: '', stderr: '' }), false);
    expect(b.chatgpt.find()).toBeNull();
    expect(b.antigravity.find()).toBeNull();
  });
});

// Live check against the real apps on this PC (uses Sir's plan quota): JARVIS_LIVE_CLI=1.
describe.runIf(process.env['JARVIS_LIVE_CLI'] === '1')('live subscription apps', () => {
  it('ChatGPT through Codex answers', async () => {
    const b = createCliBrains({ workDir: mkdtempSync(join(tmpdir(), 'cli-live-')) });
    expect(await b.chatgpt.run('Reply with exactly: OK', signal)).toMatch(/OK/);
  }, 180_000);
});
