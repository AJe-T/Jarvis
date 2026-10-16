import { z } from 'zod';
import { ToolError } from '../../errors';
import { defineTool, fail, ok, type Tool } from '../types';
import { geocode, type Fetch } from './weather';

/**
 * Quick-answer plugins found in nearly every Jarvis on GitHub (Gladiator07/JARVIS,
 * BolisettySujith/J.A.R.V.I.S, kishanrajput23/Jarvis-Desktop-Voice-Assistant): a Wikipedia summary,
 * a dictionary and "how far is X from Y". Keyless APIs, checked 2026-10: Wikipedia Action API
 * (generator=search + TextExtracts), Free Dictionary API (dictionaryapi.dev), Open-Meteo geocoding.
 * One call each, so they also work well with small local models.
 */

const TIMEOUT = 15_000;
const UA = 'JarvisDesktop/2.6 (personal Windows desktop assistant)';
const EARTH_KM = 6371.0088;
const KM_PER_MILE = 1.609344;
/** Typical airliner block speed, for a rough "about N hours by air". */
const FLIGHT_KMH = 800;

/** Great-circle distance in km (haversine). */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface WikiPage {
  title: string;
  extract?: string;
  fullurl?: string;
  missing?: boolean;
}

interface DictEntry {
  word: string;
  phonetic?: string;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example?: string }>;
    synonyms?: string[];
  }>;
}

export function formatDefinition(entries: DictEntry[]): string {
  const first = entries[0];
  if (!first) return 'No definition found.';
  const lines = [`${first.word}${first.phonetic ? ` ${first.phonetic}` : ''}`];
  for (const m of entries.flatMap((e) => e.meanings).slice(0, 4)) {
    const defs = m.definitions.slice(0, 2);
    defs.forEach((d, i) =>
      lines.push(
        `${i === 0 ? m.partOfSpeech : ' '.repeat(m.partOfSpeech.length)} ${i + 1}. ${d.definition}${d.example ? ` (e.g. "${d.example}")` : ''}`,
      ),
    );
    if (m.synonyms?.length) lines.push(`   synonyms: ${m.synonyms.slice(0, 5).join(', ')}`);
  }
  return lines.join('\n');
}

export function createKnowledgeTools(deps: { fetch?: Fetch } = {}): Tool[] {
  const f = deps.fetch ?? fetch;
  const get = (url: string, signal: AbortSignal): Promise<Response> =>
    f(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]),
    });

  return [
    defineTool({
      name: 'wikipedia',
      description:
        'Short Wikipedia summary of a person, place, thing or event ("who is Ada Lovelace", "tell me about the Taj Mahal"), with the article link. Faster and cheaper than web search for encyclopedic facts; use web search for news or anything recent. lang: Wikipedia language code (default en).',
      input: z.object({
        topic: z.string().trim().min(1).max(200),
        lang: z
          .string()
          .regex(/^[a-z]{2,3}$/, 'A Wikipedia language code like en, hi, fr.')
          .default('en'),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      timeoutMs: TIMEOUT + 2_000,
      summarize: ({ topic }) => `Look up "${topic}" on Wikipedia`,
      async run({ topic, lang }, ctx) {
        const url =
          `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
          `&generator=search&gsrlimit=1&gsrsearch=${encodeURIComponent(topic)}` +
          '&prop=extracts%7Cinfo&exintro=1&explaintext=1&exsentences=5&inprop=url';
        const res = await get(url, ctx.signal);
        if (!res.ok) throw new ToolError(`Wikipedia answered ${res.status}. Try again later.`);
        const body = (await res.json()) as { query?: { pages?: WikiPage[] } };
        const page = body.query?.pages?.find((p) => !p.missing);
        if (!page?.extract?.trim()) return fail(`Wikipedia has no article matching "${topic}".`);
        return {
          content: [
            {
              type: 'text',
              text: `${page.title}\n${page.extract.trim()}\nSource: ${page.fullurl ?? `https://${lang}.wikipedia.org`} (Wikipedia, CC BY-SA)`,
            },
          ],
          untrustedSource: 'Wikipedia',
        };
      },
    }),
    defineTool({
      name: 'define_word',
      description:
        'Dictionary entry for an English word: pronunciation, meanings by part of speech, examples and synonyms. Use for "what does X mean", "define X", "synonyms for X".',
      input: z.object({
        word: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[\p{L}' -]+$/u, 'One English word or short phrase.'),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      timeoutMs: TIMEOUT + 2_000,
      summarize: ({ word }) => `Define "${word}"`,
      async run({ word }, ctx) {
        const res = await get(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
          ctx.signal,
        );
        if (res.status === 404) return fail(`No dictionary entry for "${word}".`);
        if (!res.ok)
          throw new ToolError(`The dictionary service answered ${res.status}. Try again later.`);
        return {
          content: [{ type: 'text', text: formatDefinition((await res.json()) as DictEntry[]) }],
          untrustedSource: 'the dictionary',
        };
      },
    }),
    defineTool({
      name: 'distance_between',
      description:
        'Straight-line (as the crow flies) distance between two places, in km and miles, with a rough flight time. For "how far is X" use sir\'s home town (get_location) as from. Not driving directions.',
      input: z.object({
        from: z.string().trim().min(1).max(120),
        to: z.string().trim().min(1).max(120),
      }),
      tier: 'SAFE',
      timeoutMs: TIMEOUT * 2 + 2_000,
      summarize: ({ from, to }) => `Distance from ${from} to ${to}`,
      async run({ from, to }, ctx) {
        const [a, b] = await Promise.all([
          geocode(f, from, ctx.signal),
          geocode(f, to, ctx.signal),
        ]);
        const km = haversineKm(a, b);
        const name = (p: typeof a): string => [p.name, p.country].filter(Boolean).join(', ');
        const hours = km / FLIGHT_KMH;
        return ok(
          `${name(a)} → ${name(b)}: ${Math.round(km).toLocaleString('en-GB')} km (${Math.round(km / KM_PER_MILE).toLocaleString('en-GB')} miles) in a straight line` +
            (km > 150
              ? `, about ${hours < 1 ? 'under an hour' : `${hours.toFixed(1)} hours`} by air.`
              : '.'),
        );
      },
    }),
  ];
}
