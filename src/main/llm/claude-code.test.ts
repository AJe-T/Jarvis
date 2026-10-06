import { describe, expect, it } from 'vitest';
import { delta, fakeClaudeCode, result, text } from '../../../tests/integration/fake-claude-code';
import {
  claudeCodeError,
  createClaudeCodeClient,
  findClaudeCode,
  parseAuthStatus,
  renderTranscript,
  sdkEnv,
  type ClaudeCodeRuntime,
} from './claude-code';

const rt = (
  query = fakeClaudeCode(async function* () {}),
  path: string | null = 'C:/cc/claude.exe',
) => ({ path: () => path, cwd: 'C:/cwd', query: async () => query }) as ClaudeCodeRuntime;

describe('Claude Code helpers (ADR-010)', () => {
  it('finds claude.exe in the native install folder first, then on PATH', () => {
    const env = { USERPROFILE: 'C:\\Users\\Sir', PATH: 'C:\\a;C:\\b' };
    expect(findClaudeCode(env, (p) => p.endsWith('b\\claude.exe'))).toBe('C:\\b\\claude.exe');
    expect(findClaudeCode(env, () => true)).toBe('C:\\Users\\Sir\\.local\\bin\\claude.exe');
    expect(findClaudeCode(env, () => false)).toBeNull();
  });

  it('keeps only sign-in state from auth status, never the email', () => {
    const s = parseAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        subscriptionType: 'pro',
        email: 'sir@example.com',
      }),
    );
    expect(s).toEqual({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' });
    expect(parseAuthStatus('oops').loggedIn).toBe(false);
  });

  it('removes API credentials from the environment Claude Code sees', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-env';
    try {
      expect(sdkEnv()['ANTHROPIC_API_KEY']).toBeUndefined();
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('renders history with tool calls and results as text', () => {
    const out = renderTranscript([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'open notepad' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'a', name: 'open_app', input: { name: 'notepad' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(700) }],
      },
    ]);
    expect(out).toMatch(
      /^Sir: open notepad\n\[image\]\n\nJarvis: \[Jarvis used open_app \{"name":"notepad"\}\]\n\nJarvis: \[Result: x{600}…\]$/,
    );
  });

  it('maps plan errors to messages Sir can act on', () => {
    expect(claudeCodeError('rate_limit', 'x', 'm').userMessage).toMatch(/usage limit/);
    expect(claudeCodeError('model_not_found', 'x', 'claude-opus-5-5').userMessage).toMatch(
      /can't use claude-opus-5-5/,
    );
    expect(claudeCodeError('overloaded', 'x', 'm').code).toBe('LLM_OVERLOADED');
    expect(claudeCodeError('billing_error', 'Card declined', 'm').userMessage).toMatch(
      /Card declined/,
    );
    expect(claudeCodeError(undefined, 'boom', 'm').userMessage).toMatch(/boom/);
  });
});

describe('createClaudeCodeClient (background calls)', () => {
  it('returns one text message with usage, streaming deltas', async () => {
    const q = fakeClaudeCode(async function* () {
      yield delta('A short ');
      yield text('m1', 'A short title');
      yield result();
    });
    const deltas: string[] = [];
    const msg = await createClaudeCodeClient(rt(q)).stream(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        system: 'Title it.',
        messages: [{ role: 'user', content: 'hi' }],
      },
      { signal: new AbortController().signal, onText: (d) => deltas.push(d) },
    );
    expect(msg.content).toEqual([{ type: 'text', text: 'A short title', citations: null }]);
    expect(msg.usage.input_tokens).toBe(1200);
    expect(deltas).toEqual(['A short ']);
    expect(q.calls[0]).toMatchObject({
      maxTurns: 1,
      tools: [],
      systemPrompt: 'Title it.',
      includePartialMessages: true,
    });
  });

  it('refuses tool requests (computer control) and a missing install', async () => {
    const signal = new AbortController().signal;
    const req = { model: 'm', max_tokens: 5, messages: [{ role: 'user' as const, content: 'x' }] };
    await expect(
      createClaudeCodeClient(rt()).stream(
        { ...req, tools: [{ name: 'x', input_schema: { type: 'object' } }] },
        { signal },
      ),
    ).rejects.toMatchObject({ userMessage: /needs an Anthropic API key/ });
    await expect(
      createClaudeCodeClient(rt(undefined, null)).stream(req, { signal }),
    ).rejects.toMatchObject({
      userMessage: /not installed/,
    });
  });

  it('throws the mapped error when the result is an error', async () => {
    const q = fakeClaudeCode(async function* () {
      yield { ...text('m1', ''), error: 'rate_limit' };
      yield result('success', { is_error: true, result: 'limit' });
    });
    await expect(
      createClaudeCodeClient(rt(q)).stream(
        { model: 'm', max_tokens: 5, messages: [{ role: 'user', content: 'x' }] },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: 'LLM_OVERLOADED' });
  });
});
