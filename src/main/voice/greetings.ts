/**
 * Instant spoken lines that need no model call: said the moment Jarvis is woken, or while a
 * request goes to the model, so Sir hears an answer in well under a second.
 */

/** Woken by name or wake word: Jarvis listens once this has been said. */
export const WAKE_LINES = [
  'Yes, sir?',
  "I'm listening, sir.",
  'At your service, sir.',
  'What can I do for you, sir?',
  'Go ahead, sir.',
  'Sir?',
] as const;

/** A request is on its way to the model; the real answer follows. */
export const WORKING_LINES = [
  'On it, sir.',
  'Right away, sir.',
  'Working on it, sir.',
  'Looking into it, sir.',
  'One moment, sir.',
  'Give me a second, sir.',
] as const;

/** A random line, never the same one twice in a row. */
export function createLinePicker(
  lines: readonly string[],
  random: () => number = Math.random,
): () => string {
  let last = -1;
  return () => {
    let i = Math.floor(random() * lines.length);
    if (i === last && lines.length > 1) i = (i + 1) % lines.length;
    last = i;
    return lines[i] as string;
  };
}
