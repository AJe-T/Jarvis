import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { JarvisError, ToolError } from '../errors';
import { parseNote } from '../memory/frontmatter';
import type { SettingsService } from '../settings/settings-service';
import { defineTool, ok, type Tool } from '../tools/types';

/**
 * Skills (OpenJarvis / agentskills.io format): a folder with SKILL.md (YAML frontmatter `name`,
 * `description`, then instructions) and optional reference files. Jarvis lists name + description
 * in its context and loads the full instructions only when a task needs them (use_skill).
 * Skills are instructions, never code Jarvis runs: every action still goes through the tool policy.
 */

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
/** Text files a skill may carry and Jarvis may read back (read_skill_file). */
const TEXT = /\.(md|txt|json|ya?ml|csv|tsv|py|js|ts|sh|ps1|html|css|xml|toml|ini)$/i;

export interface Skill {
  name: string;
  description: string;
  license?: string;
  dir: string;
  enabled: boolean;
  files: string[];
}

export interface SkillFile {
  path: string;
  content: string;
}

/** Validates SKILL.md frontmatter (agentskills.io: name 1–64 lowercase-hyphen, description ≤ 1024). */
export function parseSkillMd(markdown: string): {
  name: string;
  description: string;
  license?: string | undefined;
  body: string;
} {
  const { frontmatter, body } = parseNote(markdown);
  const fm = z
    .object({
      name: z.string().regex(NAME).max(64),
      description: z.string().min(1).max(1024),
      license: z.string().max(200).optional(),
    })
    .safeParse(frontmatter);
  if (!fm.success)
    throw new JarvisError(
      'INVALID',
      fm.error.issues[0]?.message ?? 'bad SKILL.md',
      'SKILL.md needs frontmatter with a lowercase-hyphen "name" and a "description".',
    );
  return { ...fm.data, body: body.trim() };
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

export function createSkillStore(deps: {
  root: string;
  settings: SettingsService;
  fetch?: typeof fetch;
}) {
  const f = deps.fetch ?? fetch;
  const disabled = (): Set<string> => new Set(deps.settings.get('skills.disabled'));
  const inside = (base: string, rel: string): string => {
    const p = resolve(base, rel);
    if (p !== base && !p.startsWith(base + sep))
      throw new ToolError('That file is outside the skill.');
    return p;
  };

  async function list(): Promise<Skill[]> {
    if (!existsSync(deps.root)) return [];
    const off = disabled();
    const out: Skill[] = [];
    for (const e of await readdir(deps.root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = join(deps.root, e.name);
      try {
        const meta = parseSkillMd(await readFile(join(dir, 'SKILL.md'), 'utf8'));
        out.push({
          name: meta.name,
          description: meta.description,
          ...(meta.license ? { license: meta.license } : {}),
          dir,
          enabled: !off.has(meta.name),
          files: (await walk(dir)).filter((p) => p !== 'SKILL.md'),
        });
      } catch {
        // A folder without a valid SKILL.md is ignored.
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function get(name: string): Promise<Skill> {
    const s = (await list()).find((x) => x.name === name);
    if (!s) throw new ToolError(`No skill called "${name}".`);
    return s;
  }

  /** Writes a validated skill (files already in memory) into skills/<name>/, replacing an older copy. */
  async function save(files: SkillFile[]): Promise<Skill> {
    const md = files.find((x) => x.path === 'SKILL.md');
    if (!md)
      throw new JarvisError(
        'INVALID',
        'no SKILL.md',
        'That folder has no SKILL.md at its top level.',
      );
    const meta = parseSkillMd(md.content);
    if (files.length > MAX_FILES)
      throw new JarvisError(
        'INVALID',
        'too many files',
        `A skill may have at most ${MAX_FILES} files.`,
      );
    const total = files.reduce((a, x) => a + Buffer.byteLength(x.content), 0);
    if (total > MAX_TOTAL_BYTES)
      throw new JarvisError('INVALID', 'too big', 'That skill is larger than 5 MB.');
    const dir = join(deps.root, meta.name);
    await rm(dir, { recursive: true, force: true });
    for (const file of files) {
      const target = inside(dir, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
    }
    return get(meta.name);
  }

  return {
    list,
    get,
    /** Copies a skill folder (text files only, size-limited) into Jarvis's skills folder. */
    async installFromFolder(folder: string): Promise<Skill> {
      const files: SkillFile[] = [];
      for (const rel of await walk(folder)) {
        if (rel !== 'SKILL.md' && !TEXT.test(rel)) continue;
        const p = join(folder, rel);
        if ((await stat(p)).size > MAX_FILE_BYTES) continue;
        files.push({ path: rel, content: await readFile(p, 'utf8') });
      }
      return save(files);
    },

    /**
     * github.com/<owner>/<repo>[/tree/<ref>/<path>] → the skill folder at that path (public repos),
     * via the GitHub contents API. Only text files; binaries are skipped.
     */
    async installFromGitHub(url: string): Promise<Skill> {
      const m =
        /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+)((?:\/[^/]+)*))?\/?$/.exec(
          url.trim(),
        );
      if (!m)
        throw new JarvisError(
          'INVALID',
          'bad url',
          'Use a GitHub link like https://github.com/owner/repo/tree/main/skills/my-skill',
        );
      const [, owner, repo, ref, path = ''] = m;
      const files: SkillFile[] = [];
      const root = path.replace(/^\//, '');
      const fetchDir = async (dirPath: string): Promise<void> => {
        const api = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
        const res = await f(api, {
          headers: { accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok)
          throw new JarvisError(
            'NOT_FOUND',
            `github ${res.status}`,
            `GitHub answered ${res.status} for that link.`,
          );
        const entries = (await res.json()) as Array<{
          type: string;
          path: string;
          size: number;
          download_url: string | null;
        }>;
        for (const e of Array.isArray(entries) ? entries : []) {
          const rel = root ? e.path.slice(root.length + 1) : e.path;
          if (e.type === 'dir') await fetchDir(e.path);
          else if (
            e.type === 'file' &&
            e.download_url &&
            e.size <= MAX_FILE_BYTES &&
            (rel === 'SKILL.md' || TEXT.test(rel))
          ) {
            if (files.length >= MAX_FILES) return;
            const body = await f(e.download_url, { signal: AbortSignal.timeout(20_000) });
            if (body.ok) files.push({ path: rel, content: await body.text() });
          }
        }
      };
      await fetchDir(root);
      return save(files);
    },

    async remove(name: string): Promise<void> {
      const s = await get(name);
      await rm(s.dir, { recursive: true, force: true });
    },

    setEnabled(name: string, enabled: boolean): void {
      const off = disabled();
      if (enabled) off.delete(name);
      else off.add(name);
      deps.settings.set('skills.disabled', [...off]);
    },

    async read(name: string): Promise<string> {
      return readFile(join((await get(name)).dir, 'SKILL.md'), 'utf8');
    },

    /** "name — description" for the context block (enabled skills only). */
    async summary(): Promise<string> {
      return (await list())
        .filter((s) => s.enabled)
        .map((s) => `${s.name} — ${s.description}`)
        .join('; ');
    },

    tools(): Tool[] {
      return [
        defineTool({
          name: 'use_skill',
          description:
            'Load the full instructions of an installed skill (listed in your context under Skills) before doing a task it covers. Returns the instructions and the files it includes.',
          input: z.object({ name: z.string().regex(NAME).max(64) }),
          tier: 'SAFE',
          summarize: ({ name }) => `Load skill ${name}`,
          async run({ name }) {
            const s = await get(name);
            if (!s.enabled)
              throw new ToolError(`The skill "${name}" is turned off in Settings → Skills.`);
            const { body } = parseSkillMd(await readFile(join(s.dir, 'SKILL.md'), 'utf8'));
            return ok(
              `<skill name="${s.name}" installed_by="sir">\n${body}\n</skill>\nFiles in this skill (read with read_skill_file): ${s.files.join(', ') || 'none'}.\nFollow these instructions using your normal tools; every action is still checked and confirmed as usual.`,
            );
          },
        }),
        defineTool({
          name: 'read_skill_file',
          description:
            'Read a reference file that belongs to an installed skill (path as listed by use_skill).',
          input: z.object({
            name: z.string().regex(NAME).max(64),
            path: z.string().min(1).max(300),
          }),
          tier: 'SAFE',
          summarize: ({ name, path }) => `Read ${path} from skill ${name}`,
          async run({ name, path }) {
            const s = await get(name);
            if (!TEXT.test(path)) throw new ToolError('Only text files in a skill can be read.');
            return ok(await readFile(inside(s.dir, path), 'utf8'));
          },
        }),
      ];
    },
  };
}

export type SkillStore = ReturnType<typeof createSkillStore>;
