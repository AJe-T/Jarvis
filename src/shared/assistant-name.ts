/** The assistant's name (Settings → General → Name): the wake word and what it calls itself. */
export const DEFAULT_NAME = 'Jarvis';

/** Common Whisper mishearings of the default name. */
const JARVIS_VARIANTS = ['jarvis', 'jervis', 'javis', 'jarvas', 'jarvi', 'charvis', 'jarviss'];

export function isDefaultName(name: string): boolean {
  return name.trim().toLowerCase() === DEFAULT_NAME.toLowerCase();
}

/** Lower-case spellings to listen for: the name itself, and the known mishearings of "Jarvis". */
export function nameVariants(name: string): string[] {
  // Spoken text never has the hyphen or apostrophe the way it was typed ("Mary-Jane" → "maryjane").
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ');
  return isDefaultName(n) ? JARVIS_VARIANTS : [n];
}
