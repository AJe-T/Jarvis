import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import type { Tool, ToolOutput } from '../types';
import { createKnowledgeTools, formatDefinition, haversineKm } from './knowledge';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};
const text = (o: ToolOutput): string => o.content.map((c) => ('text' in c ? c.text : '')).join(' ');

function setup(respond: (url: string) => Response) {
  const urls: string[] = [];
  const tools = createKnowledgeTools({
    fetch: (async (url: string) => {
      urls.push(url);
      return respond(url);
    }) as typeof fetch,
  });
  const tool = (name: string): Tool => tools.find((t) => t.name === name) as Tool;
  const run = (name: string, input: unknown): Promise<ToolOutput> =>
    tool(name).run(tool(name).input.parse(input), ctx);
  return { urls, tool, run };
}

describe('knowledge plugins (ideas from Gladiator07/JARVIS, BolisettySujith/J.A.R.V.I.S)', () => {
  it('summarises the best Wikipedia match with its link, marked untrusted', async () => {
    const t = setup(() =>
      Response.json({
        query: {
          pages: [
            {
              title: 'Ada Lovelace',
              extract: 'Augusta Ada King was an English mathematician.',
              fullurl: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
            },
          ],
        },
      }),
    );
    const out = await t.run('wikipedia', { topic: 'ada lovelace' });
    expect(t.urls[0]).toContain('https://en.wikipedia.org/w/api.php?');
    expect(t.urls[0]).toContain('gsrsearch=ada%20lovelace');
    expect(text(out)).toContain('Augusta Ada King');
    expect(text(out)).toContain('https://en.wikipedia.org/wiki/Ada_Lovelace');
    expect(t.tool('wikipedia').untrustedOutput).toBe(true);
    expect(t.tool('wikipedia').tier).toBe('SAFE');
  });

  it('says so when Wikipedia has no article, and rejects odd language codes', async () => {
    const t = setup(() => Response.json({ batchcomplete: true }));
    const out = await t.run('wikipedia', { topic: 'qwxzv' });
    expect(out.isError).toBe(true);
    expect(() => t.tool('wikipedia').input.parse({ topic: 'x', lang: 'en.evil.com/' })).toThrow();
  });

  it('defines a word and reports a missing one', async () => {
    const t = setup((url) =>
      url.endsWith('/zzqx')
        ? new Response('{}', { status: 404 })
        : Response.json([
            {
              word: 'serendipity',
              phonetic: '/ˌsɛɹənˈdɪpɪti/',
              meanings: [
                {
                  partOfSpeech: 'noun',
                  definitions: [{ definition: 'A happy accident.', example: 'pure serendipity' }],
                  synonyms: ['chance', 'luck'],
                },
              ],
            },
          ]),
    );
    const out = await t.run('define_word', { word: 'Serendipity' });
    expect(t.urls[0]).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/serendipity');
    expect(text(out)).toContain('noun 1. A happy accident. (e.g. "pure serendipity")');
    expect(text(out)).toContain('synonyms: chance, luck');
    expect((await t.run('define_word', { word: 'zzqx' })).isError).toBe(true);
    expect(() => t.tool('define_word').input.parse({ word: '../../etc' })).toThrow();
  });

  it('measures the straight-line distance between two geocoded places', async () => {
    const t = setup((url) =>
      Response.json({
        results: [
          url.includes('London')
            ? { name: 'London', country: 'United Kingdom', latitude: 51.5074, longitude: -0.1278 }
            : { name: 'Paris', country: 'France', latitude: 48.8566, longitude: 2.3522 },
        ],
      }),
    );
    const out = await t.run('distance_between', { from: 'London', to: 'Paris' });
    expect(text(out)).toMatch(/^London, United Kingdom → Paris, France: 34\d km \(21\d miles\)/);
    expect(text(out)).toContain('by air');
  });

  it('haversine is right on known pairs', () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0);
    // Quarter of the equator.
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 90 })).toBeCloseTo(
      10_007.5,
      0,
    );
    expect(formatDefinition([])).toBe('No definition found.');
  });
});
