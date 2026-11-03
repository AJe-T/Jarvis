import { describe, expect, it } from 'vitest';
import { deepgramEvents } from './deepgram-events';

function setup() {
  const out: Array<[string, unknown?]> = [];
  const ev = deepgramEvents((event, arg) => out.push(arg === undefined ? [event] : [event, arg]));
  const results = (transcript: string, isFinal = false, speechFinal = false) =>
    ev.message({
      type: 'Results',
      is_final: isFinal,
      speech_final: speechFinal,
      channel: { alternatives: [{ transcript }] },
    } as { type: string });
  return { ev, out, results };
}

describe('Deepgram live events (voice fix 1A)', () => {
  it('joins finals until speech_final', () => {
    const { out, results } = setup();
    results('what is');
    results('what is the', true);
    results('weather', true, true);
    expect(out).toEqual([
      ['partial', 'what is'],
      ['partial', 'what is the'],
      ['final', 'what is the weather'],
    ]);
  });

  it('a connection dropped mid-sentence ends the utterance with the words heard so far', () => {
    const { ev, out, results } = setup();
    results('open the', true);
    results('downloads'); // interim words of the next segment
    ev.close(1006);
    expect(out.slice(-2)).toEqual([['final', 'open the downloads'], ['utteranceEnd']]);
    results('ignored after the drop', true, true);
    expect(out.at(-1)).toEqual(['utteranceEnd']);
  });

  it('a drop before any words is an error, so listening ends at once', () => {
    const { ev, out } = setup();
    ev.close(1011);
    expect(out[0]?.[0]).toBe('error');
    expect(String(out[0]?.[1])).toMatch(/closed the connection \(code 1011\)/);
  });

  it("Jarvis's own close is not a drop", () => {
    const { ev, out, results } = setup();
    results('hello');
    ev.ending();
    ev.close(1000);
    ev.error(new Error('socket gone'));
    expect(out).toEqual([['partial', 'hello']]);
  });

  it('a socket error after words were heard answers with those words', () => {
    const { ev, out, results } = setup();
    results('lock my', true);
    ev.error(new Error('ECONNRESET'));
    expect(out.slice(-2)).toEqual([['final', 'lock my'], ['utteranceEnd']]);
  });
});

describe('Deepgram hears sound but no words', () => {
  function timed() {
    const out: Array<[string, unknown?]> = [];
    let pending: (() => void) | undefined;
    const ev = deepgramEvents(
      (event, arg) => out.push(arg === undefined ? [event] : [event, arg]),
      {
        noWordsMs: 7000,
        setTimer: (fn) => (pending = fn),
        clearTimer: () => (pending = undefined),
      },
    );
    const results = (transcript: string, isFinal = false) =>
      ev.message({
        type: 'Results',
        is_final: isFinal,
        channel: { alternatives: [{ transcript }] },
      } as { type: string });
    return { ev, out, results, fireTimer: () => pending?.(), hasTimer: () => !!pending };
  }

  it('ends the utterance (unclear) when no words follow the detector', () => {
    const { ev, out, fireTimer } = timed();
    ev.message({ type: 'SpeechStarted' });
    fireTimer();
    expect(out).toEqual([['speechStarted'], ['utteranceEnd']]);
    ev.close(1011); // Deepgram closing later is not an error any more
    expect(out).toEqual([['speechStarted'], ['utteranceEnd']]);
  });

  it('words stop the watch, so a slow sentence is never cut', () => {
    const { ev, out, results, hasTimer } = timed();
    ev.message({ type: 'SpeechStarted' });
    results('open');
    expect(hasTimer()).toBe(false);
    expect(out).toEqual([['speechStarted'], ['partial', 'open']]);
  });

  it('a drop after sound but before words asks again instead of an error', () => {
    const { ev, out } = timed();
    ev.message({ type: 'SpeechStarted' });
    ev.close(1011);
    expect(out).toEqual([['speechStarted'], ['utteranceEnd']]);
  });

  it("Jarvis's own close stops the watch", () => {
    const { ev, hasTimer } = timed();
    ev.message({ type: 'SpeechStarted' });
    ev.ending();
    expect(hasTimer()).toBe(false);
  });
});
