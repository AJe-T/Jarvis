import { describe, expect, it } from 'vitest';
import { TranscriptBuffer, isEcho, isUnclear, mentionsName, parseIntent } from './conversation';
import { createContinuousTranscriber, type HeardSegment } from './local/continuous';

describe('echo rejection', () => {
  const said = '<spoken>At your service, sir. Shall I create the folder Invoices?</spoken>';
  it.each([
    ['at your service sir', true],
    ['They service.', false], // two words, not in Jarvis's order
    ['your service', true],
    ['Sir.', true], // one word Jarvis just said, and not a command
    ['yes create the folder', false], // Sir reusing some of Jarvis's words
    ['open notepad', false],
    ['shall I create the folder invoices', true],
  ])('%s → %s', (heard, echo) => expect(isEcho(heard, said)).toBe(echo));
  it('never treats anything as echo when Jarvis said nothing', () => {
    expect(isEcho('at your service', '')).toBe(false);
  });
});

describe('unclear speech', () => {
  it.each([
    ['Yabbies!', true],
    ['', true],
    ['Hello.', false],
    ['yes', false],
    ['42', false],
    ['open notepad', false],
  ])('%s → %s', (text, unclear) => expect(isUnclear(text)).toBe(unclear));
});

describe('name anywhere in a sentence', () => {
  it.each([
    ['Jarvis, what time is it?', true],
    ['what do you think, Jarvis?', true],
    ["Jarvis's opinion matters", true],
    ['jervis open the door', true],
    ['the jarvisproject repo', false],
    ['nothing to see here', false],
  ])('%s → %s', (text, yes) => expect(mentionsName(text)).toBe(yes));
});

describe('intent judge output', () => {
  it('accepts JSON (even wrapped in prose) and rejects anything else', () => {
    expect(parseIntent('Sure: {"directed": true, "query": "What time is it?"}')).toEqual({
      directed: true,
      query: 'What time is it?',
    });
    expect(parseIntent('{"directed": true, "query": ""}').directed).toBe(false);
    expect(parseIntent('nope').directed).toBe(false);
    expect(parseIntent('{bad json}').directed).toBe(false);
  });
});

describe('rolling transcript', () => {
  it('keeps two minutes, marks speech heard while Jarvis spoke', () => {
    const b = new TranscriptBuffer(120_000);
    b.add({ text: 'old', start: 0, end: 1_000, duringSpeech: false });
    b.add({ text: 'echo?', start: 100_000, end: 101_000, duringSpeech: true });
    b.add({ text: 'Jarvis, hi', start: 129_000, end: 130_000, duringSpeech: false });
    expect(b.format(130_000)).toBe('[-29s] (while Jarvis spoke) echo?\n[-0s] Jarvis, hi');
    b.clear();
    expect(b.recent(130_000)).toEqual([]);
  });
});

describe('continuous transcriber (always-listening)', () => {
  it('turns each stretch of speech into a segment and keeps listening', async () => {
    // VAD: speech for 10 windows, quiet for 30, speech again for 10, quiet.
    const pattern = [
      ...new Array<number>(10).fill(0.9),
      ...new Array<number>(30).fill(0.05),
      ...new Array<number>(10).fill(0.9),
      ...new Array<number>(40).fill(0.05),
    ];
    let i = 0;
    const segments: HeardSegment[] = [];
    let n = 0;
    const ct = createContinuousTranscriber({
      vad: { prob: async () => pattern[i++] ?? 0, reset: () => undefined },
      transcriber: { transcribe: async () => `phrase ${++n}`, release: async () => undefined },
      onSegment: (s) => segments.push(s),
      onError: (e) => {
        throw e;
      },
    });
    for (let f = 0; f < 40; f++) ct.write(new Int16Array(1280)); // 2.5 windows each = 100 windows
    await new Promise((r) => setTimeout(r, 50));
    expect(segments.map((s) => s.text)).toEqual(['phrase 1', 'phrase 2']);
    ct.close();
  });
});
