import type { Finding } from './protected';

/**
 * Forge's design check (ideas from pbakaus/impeccable's deterministic detector and Nutlope/hallmark's
 * floor/reflex gates; rules and code are ours, taken from docs/Design-system.md). It reads only the
 * lines a change adds to the interface (src/renderer, .tsx/.css), so old code never fails a run.
 * "block" = the floor (accessibility, the text-size setting, the design system's hard rules);
 * "warn" = reflexes Sir sees in the report but that don't stop the run.
 */

interface Rule {
  id: string;
  severity: Finding['severity'];
  /** Which files the rule reads. */
  applies: (path: string) => boolean;
  test: (line: string) => boolean;
  problem: string;
  /** The finding is dropped when the whole file (after the change) matches this. */
  unless?: RegExp;
}

const UI = /^src\/renderer\/.*\.(?:tsx|css)$/i;
const TSX = (p: string): boolean => /\.tsx$/i.test(p);
const CSS = (p: string): boolean => /\.css$/i.test(p);
/** Where raw colours belong: the token, surface and global style sheets. */
const COLOUR_HOME = /\/styles\/(?:tokens|surfaces|globals)\.css$/i;
const HEX = /(?:^|[\s'"`:(,[])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const COLOUR_FN = /\b(?:rgba?|hsla?)\(/i;
const hasRawColour = (l: string): boolean => HEX.test(l) || COLOUR_FN.test(l);
const COMMENT = /^\s*(?:\/\/|\/?\*)/;

const RULES: Rule[] = [
  {
    id: 'raw-colour',
    severity: 'block',
    applies: TSX,
    test: hasRawColour,
    // WebGL (three.js) and canvas can't read CSS variables: raw colours are the only way there.
    unless: /from\s+['"](?:three|@react-three\/[\w-]+)['"]|\bgetContext\(|\bfillStyle\b/,
    problem:
      'raw colour in a component: use a token (bg-surface-1, text-ink-300, var(--…)), Design-system.md §3.4',
  },
  {
    id: 'raw-colour-css',
    severity: 'warn',
    applies: (p) => CSS(p) && !COLOUR_HOME.test(p),
    test: (l) => hasRawColour(l) && !/color-mix\(|var\(--/.test(l),
    problem: 'raw colour outside the token sheets: prefer var(--…) or color-mix()',
  },
  {
    id: 'fixed-text-size',
    severity: 'block',
    applies: TSX,
    test: (l) => /\btext-\[\d+(?:\.\d+)?px\]/.test(l),
    problem:
      'fixed text-[Npx] ignores Settings → Text size: use text-3xs…text-3xl, Design-system.md §4',
  },
  {
    id: 'icon-library',
    severity: 'block',
    applies: TSX,
    test: (l) =>
      /from\s+['"](?:react-icons|@heroicons|@mui\/icons-material|@fortawesome|phosphor-react|@phosphor-icons|@tabler\/icons)/.test(
        l,
      ),
    problem: 'icons are Lucide only (lucide-react), Design-system.md §9',
  },
  {
    id: 'positive-tabindex',
    severity: 'block',
    applies: TSX,
    test: (l) => /tabIndex=\{?\s*['"]?[1-9]/.test(l),
    problem: 'a positive tabIndex breaks keyboard order: use 0 or -1',
  },
  {
    id: 'focus-removed',
    severity: 'block',
    applies: (p) => CSS(p) || TSX(p),
    // A Tailwind focus class on the same element (focus:border-…, focus-visible:ring-…) replaces it.
    test: (l) =>
      (/outline\s*:\s*['"]?(?:none|0)\b/.test(l) || /\boutline-none\b/.test(l)) &&
      !/\bfocus(?:-visible|-within)?:(?:ring|border|shadow|bg)/.test(l),
    unless: /focus-visible|:focus(?:-within)?\b[^{]*\{[^}]*(?:border|box-shadow)/,
    problem:
      'focus outline removed with no :focus-visible style in the file: keyboard users lose their place',
  },
  {
    id: 'layout-animation',
    severity: 'warn',
    applies: CSS,
    test: (l) =>
      /\b(?:transition(?:-property)?|animation)\s*:[^;]*\b(?:width|height|top|left|right|bottom|margin|padding)\b/.test(
        l,
      ),
    problem: 'animates a layout property: animate transform or opacity instead',
  },
  {
    id: 'motion-without-reduced',
    severity: 'warn',
    applies: CSS,
    test: (l) => /@keyframes\b|\banimation\s*:/.test(l),
    unless: /prefers-reduced-motion/,
    problem:
      'new motion with no prefers-reduced-motion rule in the file: reduced motion drops all movement, Design-system.md §8',
  },
  {
    id: 'ai-gradient',
    severity: 'warn',
    applies: (p) => CSS(p) || TSX(p),
    test: (l) =>
      /gradient\([^)]*(?:purple|violet|indigo|#8b5cf6|#7c3aed|#6366f1|#a855f7)/i.test(l) ||
      /\bfrom-(?:purple|violet|indigo)-\d/.test(l),
    problem: 'purple-to-blue gradient: the generic "AI" look, not the Graphite neon palette',
  },
  {
    id: 'off-system-font',
    severity: 'warn',
    applies: (p) => CSS(p) || TSX(p),
    test: (l) =>
      /font-family\s*:(?![^;]*(?:var\(|Geist|inherit|monospace\s*;))/i.test(l) ||
      /fontFamily\s*:\s*['"](?!.*Geist)/.test(l),
    problem:
      'a font outside the system: Geist for reading, Geist Mono for the HUD, Design-system.md §4',
  },
  {
    id: 'important',
    severity: 'warn',
    applies: CSS,
    test: (l) => /!important\b/.test(l),
    problem: '!important: fix the selector instead',
  },
];

/**
 * Findings for the interface lines a change adds (`added` from nocopy.addedRuns). `read` gives a
 * file's full text after the change, for rules that look at the whole file (focus, reduced motion).
 */
export function designFindings(
  added: ReadonlyMap<string, string[][]>,
  read: (path: string) => string,
): Finding[] {
  const findings: Finding[] = [];
  for (const [path, runs] of added) {
    if (!UI.test(path)) continue;
    const lines = runs.flat().filter((l) => !COMMENT.test(l));
    let whole: string | null = null;
    const fileText = (): string => (whole ??= read(path));
    for (const rule of RULES) {
      const f = checkRule(rule, path, lines, fileText);
      if (f) findings.push(f);
    }
  }
  return findings;
}

function checkRule(
  rule: Rule,
  path: string,
  lines: readonly string[],
  fileText: () => string,
): Finding | null {
  if (!rule.applies(path)) return null;
  const hits = lines.filter(rule.test);
  if (hits.length === 0) return null;
  if (rule.unless?.test(fileText())) return null;
  const first = (hits[0] ?? '').trim().slice(0, 80);
  const where = hits.length === 1 ? first : `${hits.length} lines, first: ${first}`;
  return { path, severity: rule.severity, problem: `${rule.problem} (${where})` };
}
