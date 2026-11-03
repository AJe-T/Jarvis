/** A Deepgram live "Results" message (the fields Jarvis reads; API-Guide.md §9.2). */
interface DgResults {
  type: 'Results';
  is_final?: boolean;
  speech_final?: boolean;
  channel: { alternatives: Array<{ transcript?: string }> };
}

type Fire = (event: string, ...args: unknown[]) => void;

/**
 * Deepgram's voice detector also fires on fans, traffic and TV. Once it has, words must follow within
 * this long, or the utterance ends as "didn't catch that" (Jarvis asks again) instead of the mic
 * staying open for the 30 s limit and ending in a "speech recognition failed" error.
 */
export const NO_WORDS_MS = 7000;

interface Timers {
  noWordsMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/**
 * Deepgram socket events → SttSession events. Finals are joined until Deepgram says the speaker
 * finished (speech_final or UtteranceEnd). If the connection drops mid-utterance (network, Deepgram
 * closing it), whatever was heard becomes the final at once instead of the voice controller waiting
 * for its 30 s limit; with nothing heard it is an error.
 */
export function deepgramEvents(fire: Fire, timers: Timers = {}) {
  const {
    noWordsMs = NO_WORDS_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  } = timers;
  let finalParts: string[] = [];
  /** Everything heard of the current utterance, interim words included. */
  let heard = '';
  /** Jarvis closed the session itself: the socket closing is expected. */
  let ending = false;
  let over = false;
  /** Deepgram's detector heard sound; any words since? */
  let speechStarted = false;
  let words = false;
  let noWords: unknown;

  function stopWatch(): void {
    if (noWords !== undefined) clearTimer(noWords);
    noWords = undefined;
  }

  function endEarly(why: string): void {
    over = true;
    stopWatch();
    const text = heard.trim() || finalParts.join(' ');
    if (text) {
      fire('final', text);
      fire('utteranceEnd');
    } else if (speechStarted)
      fire('utteranceEnd'); // sound but no words: "didn't catch that"
    else fire('error', new Error(why));
  }

  function noteWords(): void {
    words = true;
    stopWatch();
  }

  function onSpeechStarted(): void {
    speechStarted = true;
    fire('speechStarted');
    if (words || noWords !== undefined) return;
    noWords = setTimer(() => {
      noWords = undefined;
      if (!over && !words) {
        over = true;
        fire('utteranceEnd');
      }
    }, noWordsMs);
  }

  return {
    message(msg: { type: string }): void {
      if (over) return;
      if (msg.type === 'Results') {
        const r = msg as DgResults;
        const text = r.channel.alternatives[0]?.transcript ?? '';
        if (text) noteWords();
        if (r.is_final) {
          if (text) finalParts.push(text);
          if (r.speech_final && finalParts.length) {
            fire('final', finalParts.join(' '));
            finalParts = [];
            heard = '';
          } else {
            heard = finalParts.join(' ');
            fire('partial', heard);
          }
        } else if (text) {
          heard = [...finalParts, text].join(' ');
          fire('partial', heard);
        }
      } else if (msg.type === 'UtteranceEnd') {
        if (finalParts.length) fire('final', finalParts.join(' '));
        finalParts = [];
        heard = '';
        fire('utteranceEnd');
      } else if (msg.type === 'SpeechStarted') onSpeechStarted();
    },

    error(err: unknown): void {
      if (over || ending) return;
      // A failing socket after words were heard still answers with those words.
      if (heard.trim() || finalParts.length || speechStarted)
        return endEarly(err instanceof Error ? err.message : String(err));
      over = true;
      stopWatch();
      fire('error', err instanceof Error ? err : new Error(String(err)));
    },

    close(code?: number): void {
      if (over || ending) return;
      endEarly(`Deepgram closed the connection${code ? ` (code ${code})` : ''}`);
    },

    /** Called before Jarvis closes the session, so its own close isn't taken for a drop. */
    ending(): void {
      ending = true;
      stopWatch();
    },
  };
}
