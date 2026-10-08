import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { z } from 'zod';
import { JarvisError } from '../errors';
import { sha256 } from '../lib/util';
import { parseNote, stringifyNote } from '../memory/frontmatter';
import type { VaultService } from '../memory/vault-service';
import type { SettingsService } from '../settings/settings-service';
import { defineTool, fail, ok, type Tool } from '../tools/types';

/**
 * Spaces (Notion-style workspace, PRD F18): Sir's own sections — Learning, Finance, Ideas … — each a
 * folder of Markdown pages under <vault>/Spaces/. Living in the Obsidian vault means Obsidian opens
 * them, the Brain graph shows them, and Jarvis's memory search can use them as reference.
 */

export const SPACES_DIR = 'Spaces';
// Windows file-name rules: no reserved characters, no trailing dot or space, not "." or "..".
// eslint-disable-next-line no-control-regex
const NAME_RE = /^(?!\.{1,2}$)[^<>:"/\\|?*\u0000-\u001f]{1,80}(?<![. ])$/;
export const SpaceName = z.string().trim().regex(NAME_RE, 'Use letters, numbers and spaces.');

export interface SpaceInfo {
  name: string;
  icon: string;
  pageCount: number;
  updatedAt: string | null;
}

export interface PageInfo {
  name: string;
  updatedAt: string;
  size: number;
  excerpt: string;
}

/** The page title is its file name (shown above the editor), so templates start below it. */
const TEMPLATES = {
  blank: () => '',
  journal: () => `## How I feel

## What happened

## What I learned

## Tomorrow
- [ ] 
`,
  learning: () =>
    `**Source:** 

## Key ideas
- 

## In my own words

## Questions
- 

## Next steps
- [ ] 
`,
  meeting: () =>
    `**When:** 
**Who:** 

## Agenda
- 

## Notes

## Decisions
- 

## Action items
- [ ] 
`,
  finance: () =>
    `| Date | Item | Category | Amount |
|---|---|---|---|
|  |  |  |  |

**Total:** 
`,
  project: () =>
    `**Goal:** 
**Status:** Planning

## Why

## Milestones
- [ ] 

## Resources
- 
`,
} satisfies Record<string, (title: string) => string>;
export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>;

function clean(name: string, what: string): string {
  const r = SpaceName.safeParse(name);
  if (!r.success)
    throw new JarvisError(
      'INVALID',
      `bad ${what} name`,
      `"${name}" can't be used as a ${what} name. Avoid < > : " / \\ | ? * and a trailing dot.`,
    );
  return r.data;
}

export function createSpaces(deps: {
  vault: VaultService;
  settings: SettingsService;
  onChanged(paths: string[]): void;
}) {
  const { vault, settings } = deps;
  const spaceRel = (space: string): string => `${SPACES_DIR}/${clean(space, 'space')}`;
  const pageRel = (space: string, page: string): string =>
    `${spaceRel(space)}/${clean(page, 'page')}.md`;

  function icons(): Record<string, string> {
    return settings.get('spaces.icons');
  }

  async function pages(space: string): Promise<PageInfo[]> {
    const entries = await vault.list(spaceRel(space));
    const out: PageInfo[] = [];
    for (const e of entries) {
      if (e.isDir || !e.name.toLowerCase().endsWith('.md')) continue;
      const abs = vault.resolve(e.path);
      const [raw, st] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
      const body = parseNote(raw)
        .body.replace(/^#.*$/m, '')
        .replace(/[#*_>`|-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({
        name: e.name.replace(/\.md$/i, ''),
        updatedAt: st.mtime.toISOString(),
        size: st.size,
        excerpt: body.slice(0, 140),
      });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function list(): Promise<SpaceInfo[]> {
    await mkdir(vault.resolve(SPACES_DIR), { recursive: true });
    const out: SpaceInfo[] = [];
    for (const e of await vault.list(SPACES_DIR)) {
      if (!e.isDir) continue;
      const p = await pages(e.name).catch(() => []);
      out.push({
        name: e.name,
        icon: icons()[e.name] ?? '📁',
        pageCount: p.length,
        updatedAt: p[0]?.updatedAt ?? null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function read(space: string, page: string): Promise<{ markdown: string; hash: string }> {
    const r = await vault.read(pageRel(space, page));
    return { markdown: r.raw, hash: r.hash };
  }

  async function write(
    space: string,
    page: string,
    markdown: string,
    expectedHash?: string,
  ): Promise<{ markdown: string; hash: string }> {
    const rel = pageRel(space, page);
    // Sir's own edit from the editor: he saw the current file, so no merge.
    const current = vault.exists(rel) ? await vault.read(rel) : null;
    await vault.write(rel, markdown, { expectedHash: expectedHash ?? current?.hash });
    deps.onChanged([rel]);
    return read(space, page);
  }

  async function move(fromRel: string, toRel: string): Promise<void> {
    const to = vault.resolve(toRel);
    if (existsSync(to))
      throw new JarvisError('INVALID', 'exists', 'Something with that name already exists.');
    await rename(vault.resolve(fromRel), to);
    deps.onChanged([fromRel, toRel]);
  }

  return {
    list,
    pages,
    read,
    write,
    templates: TEMPLATE_NAMES,

    async create(name: string, icon: string): Promise<void> {
      const rel = spaceRel(name);
      if (vault.exists(rel))
        throw new JarvisError('INVALID', 'exists', `A space called "${name}" already exists.`);
      await mkdir(vault.resolve(rel), { recursive: true });
      settings.set('spaces.icons', { ...icons(), [clean(name, 'space')]: icon });
      deps.onChanged([rel]);
    },

    async update(
      name: string,
      next: { name?: string | undefined; icon?: string | undefined },
    ): Promise<void> {
      const from = clean(name, 'space');
      const to = next.name ? clean(next.name, 'space') : from;
      if (to !== from) await move(spaceRel(from), spaceRel(to));
      const { [from]: oldIcon, ...rest } = icons();
      settings.set('spaces.icons', { ...rest, [to]: next.icon ?? oldIcon ?? '📁' });
    },

    async remove(name: string): Promise<void> {
      await vault.trash(spaceRel(name));
      const { [clean(name, 'space')]: _gone, ...rest } = icons();
      settings.set('spaces.icons', rest);
      deps.onChanged([spaceRel(name)]);
    },

    /** New page from a template; picks "Title 2", "Title 3"… if the name is taken. */
    async createPage(space: string, title: string, template: string): Promise<string> {
      const base = clean(title, 'page');
      let name = base;
      for (let i = 2; vault.exists(pageRel(space, name)); i++) name = `${base} ${i}`;
      const make =
        (TEMPLATES as Record<string, (t: string) => string>)[template] ?? TEMPLATES.blank;
      await write(space, name, stringifyNote({ created: new Date().toISOString() }, make(name)));
      return name;
    },

    async renamePage(space: string, page: string, next: string): Promise<void> {
      await move(pageRel(space, page), pageRel(space, next));
    },

    async removePage(space: string, page: string): Promise<void> {
      const rel = pageRel(space, page);
      await vault.trash(rel);
      deps.onChanged([rel]);
    },

    hashOf: (markdown: string): string => sha256(markdown),
  };
}

export type Spaces = ReturnType<typeof createSpaces>;

/** Lets Jarvis use Spaces as Sir's notebook: list, read, add to a page or start a new one. */
export function createSpacesTool(spaces: Spaces): Tool {
  return defineTool({
    name: 'spaces',
    description:
      "Sir's Spaces: his own notebooks (e.g. Learning, Finance, Ideas), each a set of Markdown pages. action=list_spaces; list_pages (space); read_page (space, page); append (space, page, text: adds to the end, creates the page if missing); create_page (space, page, text). Use when sir says 'add this to my Finance space', 'what did I write in Learning about X'. Never delete or overwrite.",
    input: z.object({
      action: z.enum(['list_spaces', 'list_pages', 'read_page', 'append', 'create_page']),
      space: z.string().max(80).optional(),
      page: z.string().max(80).optional(),
      text: z.string().max(20_000).optional(),
    }),
    tier: 'SAFE',
    summarize: (i) =>
      i.action === 'list_spaces'
        ? 'List Spaces'
        : `${i.action.replace('_', ' ')} ${[i.space, i.page].filter(Boolean).join(' / ')}`,
    async run(i) {
      const needSpace = (): string => {
        if (!i.space) throw new JarvisError('INVALID', 'space', 'Give the space name.');
        return i.space;
      };
      const needPage = (): string => {
        if (!i.page) throw new JarvisError('INVALID', 'page', 'Give the page name.');
        return i.page;
      };
      switch (i.action) {
        case 'list_spaces': {
          const all = await spaces.list();
          return ok(
            all.length
              ? all.map((s) => `${s.icon} ${s.name} (${s.pageCount} pages)`).join('\n')
              : 'Sir has no Spaces yet.',
          );
        }
        case 'list_pages': {
          const p = await spaces.pages(needSpace());
          return ok(p.length ? p.map((x) => `${x.name}: ${x.excerpt}`).join('\n') : 'No pages.');
        }
        case 'read_page':
          return ok((await spaces.read(needSpace(), needPage())).markdown);
        case 'append': {
          const space = needSpace();
          const page = needPage();
          if (!i.text) return fail('Give the text to add.');
          const exists = await spaces.read(space, page).catch(() => null);
          if (!exists) await spaces.create(space, '📁').catch(() => undefined);
          const md = exists
            ? `${exists.markdown.trimEnd()}\n\n${i.text.trim()}\n`
            : `# ${page}\n\n${i.text.trim()}\n`;
          await spaces.write(space, page, md, exists?.hash);
          return ok(`Added to ${space} / ${page}.`);
        }
        case 'create_page': {
          const space = needSpace();
          await spaces.create(space, '📁').catch(() => undefined);
          const name = await spaces.createPage(space, needPage(), 'blank');
          if (i.text) {
            const cur = await spaces.read(space, name);
            await spaces.write(
              space,
              name,
              `${cur.markdown.trimEnd()}\n${i.text.trim()}\n`,
              cur.hash,
            );
          }
          return ok(`Created ${space} / ${name}.`);
        }
      }
    },
  });
}
