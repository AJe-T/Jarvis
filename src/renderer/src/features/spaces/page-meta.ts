import YAML from 'yaml';

/** Built-in covers (surfaces.css `.cover-<id>`): generated art, so no image ever leaves the PC. */
export const COVERS = [
  'grid',
  'synthwave',
  'matrix',
  'circuit',
  'aurora',
  'hazard',
  'plasma',
  'chrome',
] as const;
export type CoverId = (typeof COVERS)[number];

/** A stable small number from a name, so an uncovered page always gets the same cover. */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The cover class for a page or space: its chosen cover, else one picked from its name. */
export function coverClass(seed: string, cover?: string): string {
  const id = COVERS.find((c) => c === cover) ?? COVERS[hash(seed) % COVERS.length];
  return `cover cover-${id}`;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Sets (or with `undefined` removes) one key in a page's frontmatter block and returns the new
 * block. YAML Sir hand-edited into something unreadable is left untouched rather than replaced.
 */
export function withFrontmatter(fm: string, key: 'icon' | 'cover', value?: string): string {
  let data: Record<string, unknown> = {};
  const m = FENCE.exec(fm);
  if (m) {
    try {
      const parsed: unknown = YAML.parse(m[1] ?? '');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        data = parsed as Record<string, unknown>;
      else if (parsed !== null) return fm;
    } catch {
      return fm;
    }
  }
  const next = Object.fromEntries(
    Object.entries({ ...data, [key]: value }).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(next).length === 0) return '';
  return `---\n${YAML.stringify(next, { lineWidth: 0 }).trimEnd()}\n---\n`;
}

/** Reads `icon` and `cover` back out of a frontmatter block (unreadable YAML reads as none). */
export function readMeta(fm: string): { icon?: string; cover?: string } {
  const m = FENCE.exec(fm);
  if (!m) return {};
  try {
    const d: unknown = YAML.parse(m[1] ?? '');
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    const { icon, cover } = d as Record<string, unknown>;
    return {
      ...(typeof icon === 'string' && icon ? { icon } : {}),
      ...(typeof cover === 'string' && cover ? { cover } : {}),
    };
  } catch {
    return {};
  }
}
