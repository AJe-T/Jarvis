import { describe, expect, it } from 'vitest';
import { logger } from '../logging/logger';
import { createOutputStore, createSavedOutputTools, savedNote, splitParts } from './saved-outputs';
import type { Tool, ToolOutput } from './types';

const ctx = (conversationId = 'c1') => ({
  signal: new AbortController().signal,
  conversationId,
  turnId: 't',
  tainted: false,
  logger,
});
const text = (o: ToolOutput): string => o.content.map((c) => ('text' in c ? c.text : '')).join(' ');

/** ~60 KB of filler with one distinctive paragraph near the end. */
const LONG = [
  ...Array.from(
    { length: 400 },
    (_, i) => `Line ${i}: lorem ipsum dolor sit amet, filler text here.`,
  ),
  'The quarterly revenue grew to 42 million rupees after the monsoon launch.',
  ...Array.from({ length: 600 }, (_, i) => `Tail ${i}: more ordinary filler words go here.`),
].join('\n');

function save(store = createOutputStore(), conversationId = 'c1', untrusted = true) {
  const e = store.save({
    conversationId,
    toolName: 'fetch_web_page',
    text: LONG,
    untrusted,
    source: 'https://example.com',
    shownChars: 8 * 1024,
  });
  return { store, e };
}

describe('splitParts', () => {
  it('keeps every part within the size and cuts one huge line hard', () => {
    const parts = splitParts(`short\n${'x'.repeat(4000)}\nend`, 1500);
    expect(parts.every((p) => p.length <= 1500)).toBe(true);
    expect(parts.join('').replace(/\n/g, '')).toBe(`short${'x'.repeat(4000)}end`);
  });
});

describe('saved output store', () => {
  it('finds the relevant part with stemming and reports what was already shown', () => {
    const { store, e } = save();
    expect(e.id).toBe('o1');
    expect(e.parts).toBeGreaterThan(30);
    expect(e.shownParts).toBeGreaterThan(0);
    expect(e.shownParts).toBeLessThan(e.parts);
    const hits = store.search(e.id, 'revenue growing');
    expect(hits[0]?.text).toContain('42 million rupees');
    expect(store.part(e.id, 1)).toMatch(/^Line 0:/);
    expect(savedNote(e)).toContain('"o1"');
  });

  it('treats FTS operators in the query as plain words', () => {
    const { store, e } = save();
    expect(() => store.search(e.id, 'NEAR( "revenue" OR * -')).not.toThrow();
    expect(store.search(e.id, 'the of to')).toEqual([]); // only stopwords
  });

  it('drops the oldest outputs beyond 30', () => {
    const store = createOutputStore();
    for (let i = 0; i < 31; i++) save(store);
    expect(store.get('o1')).toBeUndefined();
    expect(store.search('o1', 'revenue')).toEqual([]);
    expect(store.get('o31')).toBeDefined();
  });
});

describe('search_tool_output', () => {
  const setup = (untrusted = true) => {
    const { store, e } = save(createOutputStore(), 'c1', untrusted);
    const tool = createSavedOutputTools(store)[0] as Tool;
    const run = (input: unknown, conv = 'c1'): Promise<ToolOutput> =>
      tool.run(tool.input.parse(input), ctx(conv));
    return { e, tool, run };
  };

  it('returns matching parts and keeps the original trust level', async () => {
    const { tool, run } = setup();
    expect(tool.tier).toBe('SAFE');
    const out = await run({ id: 'o1', query: 'quarterly revenue' });
    expect(text(out)).toContain('42 million rupees');
    expect(out.untrusted).toBe(true);
    expect(out.untrustedSource).toBe('https://example.com');
    const trusted = await setup(false).run({ id: 'o1', query: 'revenue' });
    expect(trusted.untrusted).toBe(false);
    expect((await run({ id: 'o1', query: 'what about today' })).isError).toBe(true);
  });

  it('reads a part by number', async () => {
    const { run } = setup();
    expect(text(await run({ id: 'o1', part: 1 }))).toContain('Line 0:');
    expect((await run({ id: 'o1', part: 99_999 })).isError).toBe(true);
  });

  it('never reads another conversation’s output', async () => {
    const { run } = setup();
    const out = await run({ id: 'o1', query: 'revenue' }, 'other');
    expect(out.isError).toBe(true);
    expect(text(out)).not.toContain('42 million');
  });

  it('rejects malformed ids', () => {
    const { tool } = setup();
    expect(() => tool.input.parse({ id: '1; DROP', query: 'x' })).toThrow();
  });
});
