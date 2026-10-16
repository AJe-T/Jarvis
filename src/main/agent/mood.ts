import { MOODS, type Mood } from '@shared/types';

/**
 * Emotion tags (idea from Open-LLM-VTuber): a reply may open with `<mood>happy</mood>`. The tag is
 * taken out of the stream before anyone sees or speaks it, and the orb takes the mood's colour.
 */

const TAG = /^\s*<mood>\s*([a-z]{3,12})\s*<\/mood>\s*/i;
const OPEN = '<mood>';
/** A leading tag never needs more than this; anything longer is plain text. */
const MAX_PREFIX = 40;

export function parseMood(raw: string): Mood | null {
  const m = raw.trim().toLowerCase();
  return (MOODS as readonly string[]).includes(m) ? (m as Mood) : null;
}

/** Removes every mood tag (stored history, captions, display). */
export function stripMood(text: string): string {
  return text.replace(/<mood>\s*[a-z]{0,12}\s*<\/mood>\s*/gi, '');
}

/**
 * Streaming filter for one turn: holds back the first few characters until it knows whether they
 * are a mood tag, then passes everything else through unchanged.
 */
export function createMoodFilter(onMood: (mood: Mood) => void): {
  push(delta: string): string;
  /** End of a model step (and of the turn): whatever was held back; the next step is checked again. */
  flush(): string;
} {
  let head = '';
  let decided = false;

  const decide = (force: boolean): string => {
    const m = TAG.exec(head);
    if (m) {
      decided = true;
      const mood = parseMood(m[1] ?? '');
      if (mood) onMood(mood);
      return head.slice(m[0].length);
    }
    const trimmed = head.trimStart();
    const couldBeTag = OPEN.startsWith(trimmed.slice(0, OPEN.length).toLowerCase());
    if (!force && couldBeTag && head.length < MAX_PREFIX) return '';
    decided = true;
    return head;
  };

  return {
    push(delta) {
      if (decided) return delta;
      head += delta;
      return decide(false);
    },
    flush() {
      const held = decided ? '' : decide(true);
      head = '';
      decided = false;
      return held;
    },
  };
}
