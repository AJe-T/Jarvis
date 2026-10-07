/**
 * Instant voice commands (idea from Priler/jarvis: phrase → action with no language model in the loop).
 * A spoken request that matches a routine's trigger phrase, or asks the time or date, is answered
 * on the spot: no network, no tokens, no waiting. Everything else goes to Claude as usual.
 */

export interface RoutineTriggers {
  name: string;
  triggers: string[];
}

export type QuickMatch =
  { kind: 'say'; text: string } | { kind: 'routine'; name: string; ack: string };

/** How close a heard phrase must be to a trigger (0–1) to count. Whisper mishears a word now and then. */
const MIN_SIMILARITY = 0.85;

const FILLER_START =
  /^(?:(?:hey|ok|okay|hi)\s+)?(?:jarvis\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?/;
const FILLER_END = /\s+(?:please|now|sir|jarvis|for me)$/;

/** "Jarvis, could you start work mode please?" → "start work mode". */
export function normalizePhrase(text: string): string {
  let s = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(FILLER_START, '');
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(FILLER_END, '');
  }
  return s.trim();
}

/** 1 − (edit distance / longer length): 1 is identical. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = row;
  }
  return 1 - (prev[b.length] ?? longer) / longer;
}

const TIME =
  /^(?:what(?:s| is) the time|what time is it|whats the time now|tell me the time|time)$/;
const DATE =
  /^(?:what(?:s| is) (?:the date|todays date|the date today)|what day is (?:it|today)|todays date|date)$/;

export function matchQuickCommand(
  text: string,
  routines: RoutineTriggers[],
  now: Date = new Date(),
): QuickMatch | null {
  const said = normalizePhrase(text);
  if (!said) return null;
  if (TIME.test(said))
    return {
      kind: 'say',
      text: `It's ${now.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}, sir.`,
    };
  if (DATE.test(said))
    return {
      kind: 'say',
      text: `It's ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, sir.`,
    };
  let best: { name: string; score: number } | null = null;
  for (const r of routines)
    for (const t of r.triggers) {
      const score = similarity(said, normalizePhrase(t));
      if (score >= MIN_SIMILARITY && (!best || score > best.score)) best = { name: r.name, score };
    }
  return best
    ? { kind: 'routine', name: best.name, ack: `Right away, sir. Running ${best.name}.` }
    : null;
}
