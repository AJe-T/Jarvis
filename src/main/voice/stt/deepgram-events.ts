/** A Deepgram live "Results" message (the fields Jarvis reads; API-Guide.md §9.2). */
interface DgResults {
  type: 'Results';
  is_final?: boolean;
  speech_final?: boolean;
  channel: { alternatives: Array<{ transcript?: string }> };
}

type Fire = (event: string, ...args: unknown[]) => void;

/**
 * Deepgram socket events → SttSession events. Finals are joined until Deepgram says the speaker
 * finished (speech_final or UtteranceEnd). If the connection drops mid-utterance (network, Deepgram
 * closing it), whatever was heard becomes the final at once instead of the voice controller waiting
 * for its 30 s limit; with nothing heard it is an error.
 */
export function deepgramEvents(fire: Fire) {
  let finalParts: string[] = [];
  /** Everything heard of the current utterance, interim words included. */
  let heard = '';
  /** Jarvis closed the session itself: the socket closing is expected. */
  let ending = false;
  let over = false;

  function endEarly(why: string): void {
    over = true;
    const text = heard.trim() || finalParts.join(' ');
    if (text) {
      fire('final', text);
      fire('utteranceEnd');
    } else fire('error', new Error(why));
  }

  return {
    message(msg: { type: string }): void {
      if (over) return;
      if (msg.type === 'Results') {
        const r = msg as DgResults;
        const text = r.channel.alternatives[0]?.transcript ?? '';
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
      } else if (msg.type === 'SpeechStarted') fire('speechStarted');
    },

    error(err: unknown): void {
      if (over || ending) return;
      // A failing socket after words were heard still answers with those words.
      if (heard.trim() || finalParts.length)
        return endEarly(err instanceof Error ? err.message : String(err));
      over = true;
      fire('error', err instanceof Error ? err : new Error(String(err)));
    },

    close(code?: number): void {
      if (over || ending) return;
      endEarly(`Deepgram closed the connection${code ? ` (code ${code})` : ''}`);
    },

    /** Called before Jarvis closes the session, so its own close isn't taken for a drop. */
    ending(): void {
      ending = true;
    },
  };
}
