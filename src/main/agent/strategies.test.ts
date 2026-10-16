import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TurnEnd } from './orchestrator';
import { createStrategyStore, learnFromTurn, overlap, sequence, words } from './strategies';

function store() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(__dirname, '../db/migrations/012_strategies.sql'), 'utf8'));
  return createStrategyStore(db);
}

const turn = (over: Partial<TurnEnd> & { tools?: Array<[string, boolean]> } = {}): TurnEnd => {
  const {
    tools = [
      ['open_app', true],
      ['set_volume', true],
    ],
    ...rest
  } = over;
  return {
    turnId: 't',
    conversationId: 'c',
    mode: 'text',
    userText: 'open spotify and set the volume to 30',
    isPrivate: false,
    purpose: 'chat',
    outcome: 'end_turn',
    replyText: 'Done.',
    toolSummaries: [],
    watch: {
      tainted: false,
      blocked: [],
      unanswered: [],
      tools: tools.map(([name, ok]) => ({ name, ran: true, ok })),
    },
    ...rest,
  };
};

describe('approaches that worked (ruflo ReasoningBank idea)', () => {
  it('compares requests by their words', () => {
    expect([...words('Open Spotify and set the volume to 30, please')]).toEqual([
      'open',
      'spotify',
      'set',
      'volume',
    ]);
    expect(overlap(words('open spotify'), words('open spotify now'))).toBeCloseTo(2 / 3);
    expect(sequence(['web_search', 'web_search', 'fetch_web_page', 'web_search'])).toEqual([
      'web_search',
      'fetch_web_page',
      'web_search',
    ]);
  });

  it('offers an approach only after it worked twice', () => {
    const s = store();
    learnFromTurn(s, turn());
    expect(s.hint('open spotify and set volume to 50')).toBe('');
    learnFromTurn(s, turn({ userText: 'open Spotify, set volume 40' }));
    expect(s.hint('open spotify and set volume to 50')).toBe(
      '- For a request like "open spotify and set the volume to 30", open_app → set_volume worked (2×).',
    );
    expect(s.hint('what is the weather in Pune')).toBe('');
  });

  it('stops offering an approach that keeps failing', () => {
    const s = store();
    learnFromTurn(s, turn());
    learnFromTurn(s, turn());
    learnFromTurn(
      s,
      turn({
        tools: [
          ['open_app', true],
          ['set_volume', false],
        ],
      }),
    );
    learnFromTurn(
      s,
      turn({
        tools: [
          ['open_app', true],
          ['set_volume', false],
        ],
      }),
    );
    expect(s.hint('open spotify and set the volume to 30')).toBe('');
  });

  it('never learns from private, tainted, automated, declined or single-tool turns', () => {
    const s = store();
    const w = turn().watch;
    if (!w) throw new Error('no watch');
    const skipped: TurnEnd[] = [
      turn({ isPrivate: true }),
      turn({ watch: { ...w, tainted: true } }),
      turn({ purpose: 'task' }),
      turn({ watch: { ...w, tools: [...w.tools, { name: 'open_url', ran: false, ok: false }] } }),
      turn({ tools: [['open_app', true]] }),
      turn({ outcome: 'aborted' }),
    ];
    for (const t of [...skipped, ...skipped]) learnFromTurn(s, t);
    expect(s.hint('open spotify and set the volume to 30')).toBe('');
  });
});
