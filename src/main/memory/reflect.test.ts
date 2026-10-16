import { describe, expect, it } from 'vitest';
import type { MemoryRow } from '../db/repos/memory-repos';
import type { LlmClient } from '../llm/types';
import type { UsageLedger } from '../llm/usage-ledger';
import {
  OBSERVATIONS_PATH,
  REFLECT_EVERY_MS,
  parseReflectJson,
  reflect,
  reflectDue,
  reflectInput,
  toCuratorOps,
} from './reflect';

const note = (title: string, body: string, updated = '2026-10-01T00:00:00Z'): MemoryRow => ({
  id: title,
  vault_path: `Memory/Facts/${title}.md`,
  title,
  kind: 'fact',
  tags_json: '[]',
  body,
  content_hash: title,
  source: 'curator',
  updated_at: updated,
});

describe('weekly reflection (idea from hindsight)', () => {
  it('parses the model JSON and drops weak observations', () => {
    const out = parseReflectJson(
      'Sure: {"observations":[{"text":"Sir codes late at night","links":["Work","Habits"],"confidence":0.85},{"text":"Sir may like jazz","confidence":0.4}],"outdated":["Sir works mornings"]}',
    );
    expect(out).not.toBeNull();
    const ops = toCuratorOps(out as NonNullable<typeof out>);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      path: OBSERVATIONS_PATH,
      source: 'inferred',
      facts: ['Sir codes late at night'],
      links: ['Work', 'Habits'],
    });
    expect(ops[1]).toMatchObject({ facts: [], outdated: ['Sir works mornings'] });
    expect(parseReflectJson('no json')).toBeNull();
  });

  it('feeds newest notes first within the budget', () => {
    const text = reflectInput(
      [
        note('Old', 'old body', '2026-01-01T00:00:00Z'),
        note('New', 'new body', '2026-10-01T00:00:00Z'),
      ],
      null,
    );
    expect(text.indexOf('### New')).toBeLessThan(text.indexOf('### Old'));
    expect(text).toContain('(none yet)');
  });

  it('is due when the note is missing or a week old', () => {
    const now = Date.parse('2026-10-15T00:00:00Z');
    expect(reflectDue(undefined, now)).toBe(true);
    expect(reflectDue(note('Observations', '', '2026-10-14T00:00:00Z'), now)).toBe(false);
    expect(
      reflectDue(note('Observations', '', new Date(now - REFLECT_EVERY_MS).toISOString()), now),
    ).toBe(true);
  });

  it('skips the model with too few notes, and hands observations to the curator', async () => {
    const calls: unknown[] = [];
    const llm = {
      stream: async () => ({
        content: [
          {
            type: 'text',
            text: '{"observations":[{"text":"Sir plans trips around cricket matches","links":["Trips","Cricket"],"confidence":0.9}]}',
          },
        ],
        model: 'haiku',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as LlmClient;
    const deps = (notes: MemoryRow[]) => ({
      llm: () => llm,
      model: () => 'haiku',
      ledger: { record: () => ({}) } as unknown as UsageLedger,
      curator: {
        applyOutput: async (raw: unknown, conv: string | null) => {
          calls.push({ raw, conv });
          return { applied: [`Memory/${OBSERVATIONS_PATH}`], queued: 0 };
        },
      },
      notes: () => notes,
      signal: () => new AbortController().signal,
    });
    expect(await reflect(deps([note('A', 'a')]))).toEqual({ applied: [], queued: 0 });
    expect(calls).toHaveLength(0);
    const five = ['Trips', 'Cricket', 'Work', 'Family', 'Food'].map((t) => note(t, `${t} facts`));
    const r = await reflect(deps(five));
    expect(r.applied).toEqual([`Memory/${OBSERVATIONS_PATH}`]);
    expect(calls[0]).toMatchObject({ conv: null });
  });
});
