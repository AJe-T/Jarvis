import { describe, expect, it } from 'vitest';
import { createMemoryRepos } from '@main/db/repos/memory-repos';
import { localDayRange } from '@main/memory/memory-system';
import { createRetriever } from '@main/memory/retriever';
import { createSemanticIndex, fuse, type Embedder } from '@main/memory/semantic';
import { logger } from '@main/logging/logger';
import { createWeatherTools, timeIn } from '@main/tools/everyday/weather';
import { idle, setupServices } from './helpers';

/** Three "meanings": weddings, cars, anything else. Normalised like MiniLM's output. */
const fakeEmbedder: Embedder = {
  async embed(texts) {
    return texts.map((t) => {
      const v = new Float32Array(384);
      if (/wedding|married|bride/i.test(t)) v[0] = 1;
      else if (/car|brake|engine/i.test(t)) v[1] = 1;
      else v[2] = 1;
      return v;
    });
  },
};

function setup() {
  const t = setupServices({
    rules: [{ match: 'mechanic', steps: [{ text: 'Booked the engine service, sir.' }] }],
  });
  const repos = createMemoryRepos(t.services.db);
  const memory = (vaultPath: string, title: string, body: string, hash = 'h1'): void =>
    repos.memories.upsert({
      vaultPath,
      title,
      kind: 'person',
      tags: [],
      body,
      hash,
      source: 'memory_tool',
      mtimeMs: 1,
    });
  let enabled = true;
  const semantic = createSemanticIndex({
    db: t.services.db,
    modelDir: 'unused',
    enabled: () => enabled,
    logger,
    load: async () => fakeEmbedder,
  });
  const retriever = createRetriever({
    vault: { exists: () => false } as never,
    repos,
    conversations: t.services.conversations,
    semantic,
  });
  return { ...t, repos, memory, semantic, retriever, off: () => (enabled = false) };
}

describe('semantic memory search (idea from isair/jarvis)', () => {
  it('finds a note by meaning when no keyword matches, and keeps keyword hits', async () => {
    const t = setup();
    t.memory('Memory/People/Priya.md', 'Priya', 'Getting married in December in Goa.');
    t.memory('Memory/Facts/Car.md', 'Car', 'The brakes squeak.');
    await t.semantic.sync();
    expect(t.semantic.count()).toBe(2);
    const hits = await t.retriever.findMemories("my sister's wedding plans");
    expect(hits.map((h) => h.vaultPath)).toEqual(['Memory/People/Priya.md']);
    expect(t.retriever.searchMemories("my sister's wedding plans")).toEqual([]); // keywords alone miss it
    const both = await t.retriever.findMemories('Car brakes');
    expect(both[0]?.vaultPath).toBe('Memory/Facts/Car.md');
  });

  it('re-embeds changed notes, forgets deleted ones, and searches messages too', async () => {
    const t = setup();
    t.memory('Memory/Facts/X.md', 'X', 'about the car');
    await t.semantic.sync();
    t.memory('Memory/Facts/X.md', 'X', 'about the wedding', 'h2');
    await t.semantic.sync();
    expect((await t.semantic.search('memory', 'bride', 5))[0]?.ref).toBe('Memory/Facts/X.md');
    t.repos.memories.remove('Memory/Facts/X.md');
    t.services.orchestrator.send({
      text: 'Call the mechanic about the engine noise',
      source: 'text',
    });
    await idle(t.services);
    await t.semantic.sync();
    expect(await t.semantic.search('memory', 'bride', 5)).toEqual([]);
    const convs = await t.retriever.findConversations('what did we say about my car?');
    expect(convs.map((c) => c.snippet).join(' ')).toMatch(/mechanic|engine/);
  });

  it('does nothing when switched off or the model is missing', async () => {
    const t = setup();
    t.off();
    t.memory('Memory/People/Priya.md', 'Priya', 'Getting married.');
    await t.semantic.sync();
    expect(t.semantic.count()).toBe(0);
    expect(await t.semantic.search('memory', 'wedding', 5)).toEqual([]);
  });

  it('fuses ranked lists by reciprocal rank', () => {
    expect(
      fuse(
        [
          ['a', 'b', 'c'],
          ['c', 'a'],
        ],
        2,
      ),
    ).toEqual(['a', 'c']);
  });
});

describe('date-scoped recall (isair/jarvis diary idea)', () => {
  it('lists what was said on a local day, private chats excluded', async () => {
    const t = setup();
    t.services.orchestrator.send({ text: 'Call the mechanic tomorrow', source: 'text' });
    t.services.orchestrator.send({ text: '/private mechanic secret', source: 'text' });
    await idle(t.services);
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const range = localDayRange(day, day);
    expect(new Date(range.to ?? '').getTime() - new Date(range.from ?? '').getTime()).toBe(
      24 * 3600_000,
    );
    const said = t.services.conversations.messagesBetween(range.from ?? '', range.to ?? '', 50);
    expect(said.map((m) => m.snippet)).toEqual(
      expect.arrayContaining(['Call the mechanic tomorrow', 'Booked the engine service, sir.']),
    );
    expect(said.some((m) => m.snippet.includes('secret'))).toBe(false);
    const yesterday = localDayRange('2000-01-01', '2000-01-01');
    expect(
      t.services.conversations.messagesBetween(yesterday.from ?? '', yesterday.to ?? '', 50),
    ).toEqual([]);
  });
});

describe('world time (isair/jarvis time tool)', () => {
  it('uses an IANA zone directly and geocodes a city to its zone', async () => {
    const urls: string[] = [];
    const [tool] = createWeatherTools({
      settings: {} as never,
      fetch: (async (url: string) => {
        urls.push(url);
        return Response.json({
          results: [
            {
              name: 'Tokyo',
              latitude: 35.7,
              longitude: 139.7,
              country: 'Japan',
              timezone: 'Asia/Tokyo',
            },
          ],
        });
      }) as typeof fetch,
    });
    if (!tool) throw new Error('no tool');
    const ctx = { signal: new AbortController().signal } as never;
    const zone = await tool.run(tool.input.parse({ place: 'Europe/Athens' }), ctx);
    expect(JSON.stringify(zone)).toContain('Europe/Athens');
    expect(urls).toHaveLength(0);
    const city = await tool.run(tool.input.parse({ place: 'Tokyo' }), ctx);
    expect(JSON.stringify(city)).toContain('Tokyo, Japan (Asia/Tokyo)');
    expect(timeIn('Asia/Tokyo', new Date('2026-10-07T00:00:00Z'))).toMatch(/9:00\s?am GMT\+9/i);
  });
});
