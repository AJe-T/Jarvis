import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../db/repos/conversations-repo';
import type { FreePool } from '../llm/pool/pool';
import type { SettingsService } from '../settings/settings-service';
import type { TurnContext } from './agent-loop';
import {
  createPoolTurns,
  handoverText,
  isSimple,
  looksPublic,
  poolContext,
  type PoolTurnDeps,
} from './front-door';
import type { TurnInfo } from './orchestrator';

describe('front-door rules', () => {
  it.each([
    'What is the capital of France?',
    'How far is the Moon from Earth',
    'Who wrote Hamlet?',
    'What is 15% of 2,400?',
  ])('takes "%s"', (q) => expect(isSimple(q)).toBe(true));

  it.each([
    ['first person', 'What should I cook tonight?'],
    ['his data', 'What is on my calendar?'],
    ['his people', 'Is our meeting still on?'],
    ['a PC action', 'Open Spotify and play jazz'],
    ['a message', 'Send a WhatsApp to Priya'],
    ['a link', 'Summarise https://example.com/post'],
    ['two sentences', 'Tell me about tea. Then coffee.'],
    ['several lines', 'Translate:\nhello'],
    ['long', `Explain ${'very '.repeat(30)}slowly why the sky is blue`],
    ['empty', '   '],
    ['a phone number', 'Is 9876543210 a spam number?'],
    ['an e-mail address', 'Who uses priya@example.com?'],
    ['other people’s money', 'Does Ravi owe Suresh 5000?'],
    ['Hinglish about Sir', 'mera plan kya hai?'],
    ['text the rules cannot read', 'मेरा नाम क्या है?'],
  ])('refuses %s', (_why, q) => expect(isSimple(q)).toBe(false));

  it('"public" ignores length but not personal words', () => {
    expect(looksPublic(`Explain ${'in detail '.repeat(40)}how rainbows form.`)).toBe(true);
    expect(looksPublic('Remind me about the loan')).toBe(false);
  });
});

const row = (
  seq: number,
  role: 'user' | 'assistant',
  text: string,
  extra: Partial<MessageRow> = {},
): MessageRow => ({
  id: `m${seq}`,
  conversation_id: 'c1',
  seq,
  role,
  content_json: '[]',
  text_plain: text,
  source: role === 'user' ? 'text' : 'text',
  model: null,
  stop_reason: null,
  created_at: '',
  ...extra,
});

describe('what a free AI may see', () => {
  it('only the pool’s own exchanges (trail removed) and the current question', () => {
    const c = poolContext([
      row(1, 'user', 'Tell me about my wife'),
      row(2, 'assistant', 'Asha loves tea.', { model: 'claude-sonnet-5-5' }),
      row(3, 'user', 'Capital of France?'),
      row(4, 'assistant', '', { model: 'pool:x' }), // a tool step
      row(5, 'user', '', { source: 'system' }), // its tool result
      row(6, 'assistant', 'Paris.\n\n(Free pool: answered by Groq · x.)', { model: 'pool:x' }),
      row(7, 'user', 'And Spain?'),
    ]);
    expect(c).toEqual({
      question: 'And Spain?',
      past: [{ q: 'Capital of France?', a: 'Paris.' }],
      lastByPool: true,
    });
    expect(JSON.stringify(c)).not.toContain('Asha');
  });

  it('knows when Claude answered last, or nobody yet', () => {
    expect(poolContext([row(1, 'user', 'Hi')]).lastByPool).toBeNull();
    expect(
      poolContext([
        row(1, 'user', 'Hi'),
        row(2, 'assistant', 'Hello, sir.', { model: 'claude' }),
        row(3, 'user', 'Why?'),
      ]).lastByPool,
    ).toBe(false);
  });

  it('the hand-over note is short: the last two exchanges, clipped, then the question', () => {
    const past = [
      { q: 'one', a: 'A1' },
      { q: 'two', a: 'x'.repeat(500) },
      { q: 'three', a: 'A3' },
    ];
    const note = handoverText(past, 'four?');
    expect(note).not.toContain('one');
    expect(note).toContain(`A: ${'x'.repeat(400)}…`);
    expect(note.endsWith('Current question: four?')).toBe(true);
    expect(handoverText([], 'four?')).toBe('four?');
  });
});

describe('front-door decision', () => {
  function deps(set: Record<string, unknown>, share = 0, veto = false): PoolTurnDeps {
    const settings = {
      get: (k: string) =>
        k in set
          ? set[k]
          : k === 'pool.enabled'
            ? true
            : k.startsWith('pool.delegation')
              ? false
              : 0,
    } as unknown as SettingsService;
    return {
      db: { prepare: () => ({ all: () => [] }) } as unknown as PoolTurnDeps['db'],
      conversations: {
        messages: () => [row(1, 'user', 'Who wrote Hamlet?')],
      } as unknown as PoolTurnDeps['conversations'],
      pool: {
        routes: () => [{ enabled: true, tier: 2 }],
        ready: () => true,
      } as unknown as FreePool,
      tools: () => ({}) as never,
      budget: {} as never,
      claudeBudget: {} as never,
      ledger: {} as never,
      settings,
      dayShare: () => share,
      veto: async () => veto,
    };
  }
  const info = {
    turnId: 't',
    conversationId: 'c1',
    mode: 'text',
    userText: 'Who wrote Hamlet?',
    isPrivate: false,
    purpose: 'chat',
    fastPathOk: true,
    userSeq: 1,
  } as TurnInfo;
  const ctx = { conversationId: 'c1', taint: { tainted: false } } as TurnContext;

  it('opens when switched on, or past 80% of today’s budget when budget-aware', async () => {
    expect(await createPoolTurns(deps({})).frontDoor(info, ctx)).toBeNull();
    expect(
      await createPoolTurns(deps({ 'pool.delegation.frontDoor': true })).frontDoor(info, ctx),
    ).toBe('on');
    const aware = { 'pool.delegation.budgetAware': true };
    expect(await createPoolTurns(deps(aware, 0.79)).frontDoor(info, ctx)).toBeNull();
    expect(await createPoolTurns(deps(aware, 0.8)).frontDoor(info, ctx)).toBe('budget');
  });

  it('Laya can send it back to Claude; private turns and attachments never go', async () => {
    const on = { 'pool.delegation.frontDoor': true };
    expect(await createPoolTurns(deps(on, 0, true)).frontDoor(info, ctx)).toBeNull();
    const t = createPoolTurns(deps(on));
    expect(await t.frontDoor({ ...info, isPrivate: true }, ctx)).toBeNull();
    expect(await t.frontDoor({ ...info, fastPathOk: false }, ctx)).toBeNull();
    const { userSeq: _seq, ...unpinned } = info;
    expect(await t.frontDoor(unpinned as TurnInfo, ctx)).toBeNull();
    const read = { ...ctx, taint: { tainted: false, privateSource: 'Memory and the vault' } };
    expect(await t.frontDoor(info, read)).toBeNull();
  });
});
