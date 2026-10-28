import { describe, expect, it } from 'vitest';
import { routeKey, type PoolLimits } from '@shared/free-pool';
import { migrate, openDatabase } from '../../db/connection';
import { buildAllowance, type AllowanceInput } from './allowance';

// 28 October 2026, 12:00 UTC: October has 31 days.
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const DAY = 86_400_000;

function setup(): AllowanceInput['db'] {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

function call(
  db: AllowanceInput['db'],
  daysAgo: number,
  provider: string,
  tokens: number,
  status: number | null = null,
): void {
  const at = new Date(NOW - daysAgo * DAY);
  db.prepare(
    `INSERT INTO pool_calls (job, task, at, day, connection_id, provider, model, tier, ok, status, reason, ms, input_tokens, output_tokens)
     VALUES ('j', 't', ?, ?, ?, ?, 'm', 2, ?, ?, NULL, 100, ?, 0)`,
  ).run(
    at.toISOString(),
    at.toISOString().slice(0, 10),
    `conn_${provider}`,
    provider,
    status === null ? 1 : 0,
    status,
    tokens,
  );
}

function input(over: Partial<AllowanceInput> & Pick<AllowanceInput, 'db'>): AllowanceInput {
  return {
    now: NOW,
    overrides: {},
    connections: [],
    learned: () => undefined,
    live: new Map(),
    label: (id) => id,
    ...over,
  };
}

describe('free allowance (AI Router → Usage)', () => {
  it('sums per-model daily caps, scales them to week and month, and counts use per period', () => {
    const db = setup();
    call(db, 0, 'groq', 1_000);
    call(db, 3, 'groq', 2_000);
    call(db, 20, 'groq', 4_000);
    call(db, 40, 'groq', 8_000); // last month: not counted
    call(db, 0, 'groq', 500, 429); // a refusal is not use
    const a = buildAllowance(
      input({
        db,
        connections: [
          {
            id: 'conn_groq',
            provider: 'groq',
            poolModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
          },
        ],
      }),
    );
    const g = a.providers[0];
    expect(g?.source).toBe('published');
    expect(g?.partial).toBe(false);
    expect(g?.tokens.day).toEqual({ limit: 400_000, used: 1_000 });
    expect(g?.tokens.week).toEqual({ limit: 2_800_000, used: 3_000 });
    expect(g?.tokens.month).toEqual({ limit: 12_400_000, used: 7_000 });
    expect(g?.requests.day).toEqual({ limit: 2_000, used: 1 });
    expect(a.totals.tokens.day.limit).toBe(400_000);
  });

  it('a model with no known cap makes the sum partial; a learned header fills requests in', () => {
    const db = setup();
    const learned = new Map<string, PoolLimits>([
      [routeKey('conn_groq', 'llama-3.1-8b-instant'), { rpd: 14_400 }],
    ]);
    const a = buildAllowance(
      input({
        db,
        connections: [
          {
            id: 'conn_groq',
            provider: 'groq',
            poolModels: ['openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
          },
        ],
        learned: (k) => learned.get(k),
      }),
    );
    const g = a.providers[0];
    expect(g?.partial).toBe(true);
    expect(g?.source).toBe('learned');
    expect(g?.tokens.day.limit).toBe(200_000);
    expect(g?.requests.day.limit).toBe(15_400);
  });

  it('account caps count once per key; OpenRouter’s live count wins over ours', () => {
    const db = setup();
    call(db, 0, 'openrouter', 10);
    const a = buildAllowance(
      input({
        db,
        connections: [{ id: 'conn_openrouter', provider: 'openrouter', poolModels: ['a', 'b'] }],
        live: new Map([['conn_openrouter', { used: 7, limit: 1_000, day: '2026-10-28' }]]),
      }),
    );
    const o = a.providers[0];
    expect(o?.source).toBe('live');
    expect(o?.requests.day).toEqual({ limit: 1_000, used: 7 });
    expect(o?.tokens.day.limit).toBeNull();
  });

  it('monthly allowances spread per day; unlimited stays unknown; Sir’s numbers win', () => {
    const db = setup();
    const a = buildAllowance(
      input({
        db,
        connections: [
          { id: 'conn_mistral', provider: 'mistral', poolModels: ['x'] },
          { id: 'conn_nvidia', provider: 'nvidia', poolModels: ['y'] },
          { id: 'conn_gemini', provider: 'gemini', poolModels: ['gemini-3.5-flash'] },
        ],
        overrides: { gemini: { tpd: 5_000_000 } },
      }),
    );
    const [mistral, nvidia, gemini] = ['mistral', 'nvidia', 'gemini'].map((id) =>
      a.providers.find((p) => p.id === id),
    );
    expect(mistral?.tokens.month.limit).toBe(1_000_000_000);
    expect(mistral?.tokens.day.limit).toBe(Math.round(1_000_000_000 / 31));
    expect(nvidia?.unlimited).toBe(true);
    expect(nvidia?.tokens.day.limit).toBeNull();
    expect(gemini?.source).toBe('yours');
    expect(gemini?.tokens.day.limit).toBe(5_000_000);
    expect(gemini?.requests.day.limit).toBe(20);
    // Unknown limits are left out of the total, not counted as zero.
    expect(a.totals.tokens.day.limit).toBe(Math.round(1_000_000_000 / 31) + 5_000_000);
  });

  it('early in a month the week still reaches back into last month', () => {
    const db = setup();
    call(db, 25, 'groq', 1_000); // 3 October
    call(db, 28, 'groq', 2_000); // 30 September: in the week of 3 Oct, not in its month
    const a = buildAllowance(
      input({
        db,
        now: NOW - 25 * DAY,
        connections: [{ id: 'conn_groq', provider: 'groq', poolModels: ['openai/gpt-oss-20b'] }],
      }),
    );
    expect(a.providers[0]?.tokens.week.used).toBe(3_000);
    expect(a.providers[0]?.tokens.month.used).toBe(1_000);
  });

  it('totals leave out uncapped and switched-off providers on both sides', () => {
    const db = setup();
    call(db, 0, 'cerebras', 10_000);
    call(db, 0, 'openrouter', 90_000); // no token cap: must not eat into Cerebras's "left"
    call(db, 0, 'groq', 5_000); // switched off
    const a = buildAllowance(
      input({
        db,
        connections: [
          { id: 'conn_cerebras', provider: 'cerebras', poolModels: ['gpt-oss-120b'] },
          { id: 'conn_openrouter', provider: 'openrouter', poolModels: ['x:free'] },
          { id: 'conn_groq', provider: 'groq', poolModels: ['openai/gpt-oss-20b'] },
        ],
        overrides: { groq: { enabled: false } },
      }),
    );
    expect(a.totals.tokens.day).toEqual({ limit: 1_000_000, used: 10_000 });
  });

  it('a call that never got an answer or was refused is not use', () => {
    const db = setup();
    call(db, 0, 'groq', 0, 429);
    db.prepare(
      `INSERT INTO pool_calls (job, task, at, day, connection_id, provider, model, tier, ok, status, reason, ms, input_tokens, output_tokens)
       VALUES ('j', 't', ?, ?, 'conn_groq', 'groq', 'm', 2, 0, NULL, 'timeout', 100, 0, 0)`,
    ).run(new Date(NOW).toISOString(), '2026-10-28');
    const a = buildAllowance(
      input({
        db,
        connections: [{ id: 'conn_groq', provider: 'groq', poolModels: ['openai/gpt-oss-20b'] }],
      }),
    );
    expect(a.providers[0]?.requests.day.used).toBe(0);
  });

  it('providers without a key are not shown', () => {
    expect(buildAllowance(input({ db: setup() })).providers).toEqual([]);
  });
});
