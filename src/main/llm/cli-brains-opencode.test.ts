import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCliBrains, openCodeAnswer, type runExe } from './cli-brains';

const signal = new AbortController().signal;

/** The message a failed run shows Sir (JarvisError.userMessage). */
const whatSirSees = (run: Promise<unknown>): Promise<string> =>
  run.then(
    () => 'no error',
    (err: unknown) => (err as { userMessage?: string }).userMessage ?? String(err),
  );

function brains(run: typeof runExe, installed = true) {
  return createCliBrains({
    workDir: mkdtempSync(join(tmpdir(), 'cli-opencode-')),
    env: {
      APPDATA: 'C:\\AppData',
      LOCALAPPDATA: 'C:\\Local',
      OPENAI_API_KEY: 'sk-should-not-leak',
    },
    exists: () => installed,
    run,
  });
}

/** What opencode 1.14.48 printed on this PC on 2026-11-11 (response headers cut), exit code 0. */
const AUTH_ERROR =
  '{"type":"error","timestamp":1794376124485,"sessionID":"ses_x","error":{"name":"APIError","data":{"message":"Missing Authentication header","statusCode":401,"isRetryable":false}}}';
const ev = (type: string, part: unknown): string =>
  JSON.stringify({ type, timestamp: 1, sessionID: 'ses_x', part });

describe('OpenCode as an answer brain (2.71)', () => {
  it('reads the answer from its text events and ignores the other events', () => {
    const out = [
      ev('step_start', { type: 'step-start' }),
      ev('text', { type: 'text', text: 'Paris is the capital.' }),
      ev('tool_use', { type: 'tool', tool: 'read' }),
      'not json at all',
      '{"type":"text","part":{"text":"cut off',
      ev('text', { type: 'text', text: '  It is on the Seine.  ' }),
      ev('step_finish', { type: 'step-finish' }),
    ].join('\n');
    expect(openCodeAnswer(out)).toEqual({
      answer: 'Paris is the capital.\n\nIt is on the Seine.',
      error: null,
    });
    expect(openCodeAnswer('')).toEqual({ answer: '', error: null });
  });

  it('runs read-only, without plugins or a permission flag, in an empty folder, and returns the answer', async () => {
    const seen: Array<{ exe: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
    const b = brains(async (exe, args, opts) => {
      seen.push({ exe, args, env: opts.env });
      return { code: 0, stdout: ev('text', { type: 'text', text: 'Paris.' }), stderr: '' };
    });
    expect(await b.opencode.run('Capital of France?', signal)).toBe('Paris.');
    const call = seen[0];
    expect(call?.exe).toMatch(/opencode-windows-x64[\\/]bin[\\/]opencode\.exe$/);
    expect(call?.args.slice(0, 7)).toEqual([
      'run',
      '--format',
      'json',
      '--agent',
      'plan',
      '--pure',
      '--dir',
    ]);
    expect(call?.args.at(-1)).toBe('Request:\nCapital of France?');
    expect(call?.args).not.toContain('--dangerously-skip-permissions');
    expect(call?.env?.['OPENAI_API_KEY']).toBeUndefined(); // keys never reach the app
  });

  it('turns its exit-0 provider error into a sign-in message', async () => {
    const b = brains(async () => ({ code: 0, stdout: AUTH_ERROR, stderr: '' }));
    expect(await whatSirSees(b.opencode.run('hi', signal))).toMatch(
      /not signed in.*Missing Authentication header.*opencode auth login/,
    );
  });

  it('reports other provider errors and an empty answer as failures, never as an answer', async () => {
    const upgrade =
      '{"type":"error","error":{"name":"APIError","data":{"message":"OpenCode 1.18.0 or newer is required to use the free tier"}}}';
    await expect(
      brains(async () => ({ code: 0, stdout: upgrade, stderr: '' })).opencode.run('hi', signal),
    ).rejects.toMatchObject({
      userMessage: 'OpenCode failed: OpenCode 1.18.0 or newer is required to use the free tier',
    });
    await expect(
      brains(async () => ({ code: 0, stdout: '', stderr: '' })).opencode.run('hi', signal),
    ).rejects.toMatchObject({ userMessage: 'OpenCode failed: no answer' });
    // An answer followed by an error is still an error.
    await expect(
      brains(async () => ({
        code: 0,
        stdout: `${ev('text', { text: 'partial' })}\n${AUTH_ERROR}`,
        stderr: '',
      })).opencode.run('hi', signal),
    ).rejects.toThrow();
  });

  it('knows whether it is signed in from "auth list", and is not offered when not installed', async () => {
    const withCreds = brains(async () => ({
      code: 0,
      stdout: '●  OpenRouter api\n└  1 credentials',
      stderr: '',
    }));
    expect(await withCreds.opencode.signedIn()).toBe(true);
    const none = brains(async () => ({ code: 0, stdout: '└  0 credentials', stderr: '' }));
    expect(await none.opencode.signedIn()).toBe(false);
    const odd = brains(async () => ({ code: 0, stdout: 'something else', stderr: '' }));
    expect(await odd.opencode.signedIn()).toBeNull();

    const missing = brains(async () => ({ code: 0, stdout: '', stderr: '' }), false);
    expect(missing.opencode.find()).toBeNull();
    expect(await missing.opencode.signedIn()).toBe(false);
    expect(await whatSirSees(missing.opencode.run('hi', signal))).toMatch(/Install OpenCode first/);
  });
});
