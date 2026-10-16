import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import type { Tool, ToolOutput } from '../types';
import {
  createYouTubeTools,
  formatCues,
  parseCaptionXml,
  parseVideoId,
  pickTrack,
  type CaptionTrack,
} from './youtube';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};
const text = (o: ToolOutput): string => o.content.map((c) => ('text' in c ? c.text : '')).join(' ');

const XML =
  '<?xml version="1.0"?><transcript><text start="1.2" dur="2">All right, so here we are</text>' +
  '<text start="12.6" dur="1.7">and that&amp;#39;s cool</text>' +
  '<text start="45" dur="2">the end</text></transcript>';

function setup(
  player: unknown,
  captions = XML,
  watchHtml = '{"INNERTUBE_API_KEY":"AIzaTEST-key_1"}',
) {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const tools = createYouTubeTools({
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      if (url.includes('/watch?')) return new Response(watchHtml);
      if (url.includes('/youtubei/v1/player')) return Response.json(player);
      return new Response(captions);
    }) as typeof fetch,
  });
  const tool = tools[0] as Tool;
  const run = (input: unknown): Promise<ToolOutput> => tool.run(tool.input.parse(input), ctx);
  return { calls, run, tool };
}

const PLAYER = {
  playabilityStatus: { status: 'OK' },
  videoDetails: { title: 'Me at the zoo', author: 'jawed', lengthSeconds: '19' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=de&fmt=srv3',
          languageCode: 'de',
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&fmt=srv3',
          languageCode: 'en',
          name: { simpleText: 'English' },
        },
      ],
    },
  },
};

describe('youtube_transcript (idea from camofox-browser)', () => {
  it('reads video ids from every kind of link', () => {
    expect(parseVideoId('jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
    expect(parseVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=10')).toBe('jNQXAC9IVRw');
    expect(parseVideoId('youtu.be/jNQXAC9IVRw?si=x')).toBe('jNQXAC9IVRw');
    expect(parseVideoId('https://m.youtube.com/shorts/jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
    expect(parseVideoId('https://www.youtube.com/embed/jNQXAC9IVRw')).toBe('jNQXAC9IVRw');
    expect(parseVideoId('https://evil.example/watch?v=jNQXAC9IVRw')).toBeNull();
    expect(parseVideoId('not a video')).toBeNull();
  });

  it('prefers written captions in sir’s language over auto-generated ones', () => {
    const tracks: CaptionTrack[] = [
      { baseUrl: 'a', languageCode: 'en', kind: 'asr' },
      { baseUrl: 'b', languageCode: 'fr' },
      { baseUrl: 'c', languageCode: 'en-GB' },
    ];
    expect(pickTrack(tracks, 'en')?.baseUrl).toBe('c');
    expect(pickTrack(tracks, 'hi')?.baseUrl).toBe('b');
    expect(pickTrack([], 'en')).toBeNull();
  });

  it('parses both timed-text formats and decodes double-encoded entities', () => {
    expect(parseCaptionXml(XML)[1]).toEqual({ start: 12.6, text: "and that's cool" });
    expect(
      parseCaptionXml(
        '<timedtext><body><p t="1500" d="900"><s>Hi</s> there</p></body></timedtext>',
      ),
    ).toEqual([{ start: 1.5, text: 'Hi there' }]);
  });

  it('groups lines into timestamped paragraphs', () => {
    const out = formatCues(parseCaptionXml(XML), true);
    expect(out).toBe("[00:01] All right, so here we are and that's cool\n[00:45] the end");
    expect(formatCues(parseCaptionXml(XML), false)).not.toContain('[');
  });

  it('fetches the page, the player and the captions, and returns an untrusted transcript', async () => {
    const t = setup(PLAYER);
    const out = await t.run({ video: 'https://youtu.be/jNQXAC9IVRw' });
    expect(t.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET']);
    expect(t.calls[1]?.url).toContain('/youtubei/v1/player?key=AIzaTEST-key_1');
    expect(JSON.parse(t.calls[1]?.body ?? '{}')).toMatchObject({
      videoId: 'jNQXAC9IVRw',
      context: { client: { clientName: 'ANDROID' } },
    });
    expect(t.calls[2]?.url).toContain('lang=en');
    expect(t.calls[2]?.url).not.toContain('fmt=');
    expect(text(out)).toContain('Video: Me at the zoo');
    expect(text(out)).toContain('[00:45] the end');
    expect(t.tool.untrustedOutput).toBe(true);
    expect(t.tool.tier).toBe('SAFE');
  });

  it('never follows a caption address outside youtube.com', async () => {
    const evil = structuredClone(PLAYER);
    const tracks = evil.captions.playerCaptionsTracklistRenderer.captionTracks;
    for (const tr of tracks) tr.baseUrl = 'https://attacker.example/api/timedtext?x=1';
    const t = setup(evil);
    await expect(t.run({ video: 'jNQXAC9IVRw' })).rejects.toThrow(/unexpected caption address/);
    expect(t.calls).toHaveLength(2);
  });

  it('explains videos without captions or that cannot be played', async () => {
    await expect(
      setup({ playabilityStatus: { status: 'OK' }, captions: {} }).run({ video: 'jNQXAC9IVRw' }),
    ).rejects.toThrow(/no captions/);
    await expect(
      setup({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Private video' } }).run({
        video: 'jNQXAC9IVRw',
      }),
    ).rejects.toThrow(/Private video/);
    await expect(
      setup(PLAYER, XML, '<html>consent</html>').run({ video: 'jNQXAC9IVRw' }),
    ).rejects.toThrow(/as expected/);
  });
});
