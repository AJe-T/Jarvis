/** Jarvis Browser's start page (no tracking, no account). */
export const HOME = 'https://duckduckgo.com/';

/** What Sir typed in the address bar → a web address (a search when it isn't one). */
export function addressFor(typed: string): string {
  const t = typed.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?(\/.*)?$/u.test(t))
    return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
