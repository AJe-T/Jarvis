/**
 * Memory tidy-up (idea from ruflo's memory consolidation, made safe): finds memory notes that look
 * like the same person, project or topic ("Priya" and "Priya Sharma") and puts a merge suggestion in
 * the Memory review queue. No model and no automatic edits: Sir decides, and accepting only adds the
 * missing facts to the note that is kept.
 */

export interface TidyNote {
  vault_path: string;
  title: string;
  body: string;
}

export interface TidyProposal {
  keep: string;
  other: string;
  /** Facts in `other` that `keep` doesn't have yet, as "- …" lines. */
  missing: string[];
}

/** Proposals per run, so the review queue never floods. */
export const TIDY_MAX = 5;
const SAME_FACTS = 0.6;

const words = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2),
  );

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

const facts = (body: string): string[] =>
  body
    .split(/^## History[ \t]*$/m)[0]!
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.trim());

const factKey = (l: string): string =>
  l
    .replace(/^- /, '')
    .replace(/\s*\((inferred|read)\)$/i, '')
    .toLowerCase()
    .trim();

/** "Priya" and "Priya Sharma": every word of the shorter title is in the longer one. */
function sameName(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return small.size > 0 && [...small].every((w) => big.has(w));
}

const folder = (p: string): string => p.split('/').slice(0, -1).join('/');

export function findDuplicates(notes: TidyNote[]): TidyProposal[] {
  const out: TidyProposal[] = [];
  for (let i = 0; i < notes.length && out.length < TIDY_MAX; i++) {
    for (let j = i + 1; j < notes.length && out.length < TIDY_MAX; j++) {
      const a = notes[i]!;
      const b = notes[j]!;
      if (folder(a.vault_path) !== folder(b.vault_path)) continue;
      const fa = facts(a.body);
      const fb = facts(b.body);
      const overlap = jaccard(new Set(fa.map(factKey)), new Set(fb.map(factKey)));
      const twoFactsEach = fa.length >= 2 && fb.length >= 2;
      // Topic notes ("Work", "Work tools") share words by design: names only count for people and projects.
      const named = /^Memory\/(People|Projects)\//.test(a.vault_path) && sameName(a.title, b.title);
      if (!named && !(twoFactsEach && overlap >= SAME_FACTS)) continue;
      const [keep, other, keepFacts, otherFacts] =
        fa.length >= fb.length ? [a, b, fa, fb] : [b, a, fb, fa];
      const have = new Set(keepFacts.map(factKey));
      out.push({
        keep: keep.vault_path,
        other: other.vault_path,
        missing: otherFacts.filter((f) => !have.has(factKey(f))),
      });
    }
  }
  return out;
}

/** The review-queue reason; also how a pair already suggested (or rejected) is recognised. */
export function tidyReason(p: TidyProposal): string {
  return `Looks like the same as ${p.other}. Accepting adds its missing facts here; then delete ${p.other} in Obsidian.`;
}
