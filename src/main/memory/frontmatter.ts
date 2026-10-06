import YAML from 'yaml';

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Splits "---\nyaml\n---\nbody". Invalid YAML is treated as no frontmatter (Sir may hand-edit notes). */
export function parseNote(markdown: string): ParsedNote {
  const m = FENCE.exec(markdown);
  if (!m) return { frontmatter: {}, body: markdown };
  try {
    const data: unknown = YAML.parse(m[1] ?? '');
    const frontmatter =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    return { frontmatter, body: markdown.slice(m[0].length).replace(/^\r?\n/, '') };
  } catch {
    return { frontmatter: {}, body: markdown };
  }
}

export function stringifyNote(frontmatter: Record<string, unknown>, body: string): string {
  const keys = Object.keys(frontmatter).filter((k) => frontmatter[k] !== undefined);
  if (keys.length === 0) return body;
  const yaml = YAML.stringify(Object.fromEntries(keys.map((k) => [k, frontmatter[k]])), {
    lineWidth: 0,
  }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, '')}`;
}
