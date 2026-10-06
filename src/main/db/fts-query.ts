// Database.md §5: user/LLM text never reaches MATCH directly. Each term is quoted; operators vanish.

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have he her his how i if in into is it its ' +
    'me my no not of on or our please she so tell than that the their them then there these they this to us was we ' +
    'were what when where which who why will with would you your jarvis sir about did we last week yesterday today'
  ).split(' '),
);

export function keywords(text: string, max = 12): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Returns a safe FTS5 expression ("a" OR "b"), or null when nothing searchable remains. */
export function toFtsQuery(text: string, mode: 'OR' | 'AND' = 'OR'): string | null {
  const terms = keywords(text);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(` ${mode} `);
}
