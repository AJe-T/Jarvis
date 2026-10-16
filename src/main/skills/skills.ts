import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { JarvisError, ToolError } from '../errors';
import { parseNote } from '../memory/frontmatter';
import { isActionable, scanForInjection } from '../security/injection-scan';
import type { SettingsService } from '../settings/settings-service';
import { defineTool, ok, type Tool } from '../tools/types';

/**
 * Skills (OpenJarvis / agentskills.io format): a folder with SKILL.md (YAML frontmatter `name`,
 * `description`, then instructions) and optional reference files. Jarvis lists name + description
 * in its context and loads the full instructions only when a task needs them (use_skill).
 * Skills are instructions, never code Jarvis runs: every action still goes through the tool policy.
 *
 * One link or folder may hold many skills (a Claude plugin, a skills library): every folder with a
 * SKILL.md under it is installed, turned off, so a library of hundreds doesn't fill every request.
 */

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
/** Skills one install may add (a whole library such as anthropics/knowledge-work-plugins). */
const MAX_SKILLS_PER_INSTALL = 400;
/** A file in the skill folder that means "installed but turned off" (walk() skips dot files). */
const OFF_MARKER = '.off';
const DOWNLOADS_AT_ONCE = 6;
/** Files a chosen folder may hold before the install refuses to walk it. */
const MAX_WALK = 20_000;
/** Text files a skill may carry and Jarvis may read back (read_skill_file). */
const TEXT = /\.(md|txt|json|ya?ml|csv|tsv|py|js|ts|sh|ps1|html|css|xml|toml|ini)$/i;

/** A file found for a skill before it is read: path relative to the skill folder. */
export interface SkillFileRef {
  path: string;
  size: number;
}

/**
 * Which files a skill keeps: SKILL.md, then its Markdown docs, then other text, smallest first,
 * until the file-count or size budget runs out. Big example galleries are dropped, not fatal.
 */
export function pickSkillFiles<T extends SkillFileRef>(files: T[]): { keep: T[]; dropped: number } {
  const rank = (p: string): number => (p === 'SKILL.md' ? 0 : /\.md$/i.test(p) ? 1 : 2);
  const usable = files.filter(
    (f) => f.size <= MAX_FILE_BYTES && (f.path === 'SKILL.md' || TEXT.test(f.path)),
  );
  const sorted = [...usable].sort(
    (a, b) => rank(a.path) - rank(b.path) || a.size - b.size || a.path.localeCompare(b.path),
  );
  const keep: T[] = [];
  let bytes = 0;
  for (const f of sorted) {
    if (keep.length >= MAX_FILES || bytes + f.size > MAX_TOTAL_BYTES) continue;
    keep.push(f);
    bytes += f.size;
  }
  return { keep, dropped: files.length - keep.length };
}

/** Groups repo-relative file paths by the skill folder (nearest folder with SKILL.md) they belong to. */
export function groupBySkill<T extends SkillFileRef>(files: T[]): Map<string, T[]> {
  const roots = files
    .filter((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'))
    .map((f) => posix.dirname(f.path))
    .map((d) => (d === '.' ? '' : d))
    .sort((a, b) => b.length - a.length); // deepest first, so nested skills win their own files
  const groups = new Map<string, T[]>(roots.map((r) => [r, []]));
  for (const f of files) {
    const root = roots.find((r) => r === '' || f.path.startsWith(`${r}/`));
    if (root === undefined) continue;
    groups.get(root)?.push({ ...f, path: root ? f.path.slice(root.length + 1) : f.path });
  }
  return groups;
}

/** A skill file whose contents are read only if the file is kept. */
type LazyFile = SkillFileRef & { read(): Promise<string> };

const GITHUB_URL =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)((?:\/[^/]+)*))?\/?$/;
const TreeSchema = z.object({
  tree: z
    .array(z.object({ path: z.string().max(1000), type: z.string(), size: z.number().optional() }))
    .max(100_000),
  truncated: z.boolean().optional(),
});
type TreeEntry = z.infer<typeof TreeSchema>['tree'][number];

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

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

export interface InstallResult {
  installed: Skill[];
  /** Plain-language notes for Sir: dropped files, skipped duplicates, injection-scan findings. */
  warnings: string[];
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

/** Relative paths of the files under `dir` (dot files skipped); refuses folders with more than `max`. */
async function walk(
  dir: string,
  base = dir,
  max = MAX_WALK,
  out: string[] = [],
): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, max, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
    if (out.length > max)
      throw new JarvisError(
        'INVALID',
        'folder too big',
        `That folder has more than ${max} files. Choose the folder that holds the skills.`,
      );
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

  const skillDir = (name: string): string => join(deps.root, name);

  async function load(dir: string, off: Set<string>): Promise<Skill> {
    const meta = parseSkillMd(await readFile(join(dir, 'SKILL.md'), 'utf8'));
    return {
      name: meta.name,
      description: meta.description,
      ...(meta.license ? { license: meta.license } : {}),
      dir,
      enabled: !off.has(meta.name) && !existsSync(join(dir, OFF_MARKER)),
      files: (await walk(dir)).filter((p) => p !== 'SKILL.md'),
    };
  }

  async function list(): Promise<Skill[]> {
    if (!existsSync(deps.root)) return [];
    const off = disabled();
    const dirs = (await readdir(deps.root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => join(deps.root, e.name));
    // A folder without a valid SKILL.md is ignored.
    const found = await inBatches(dirs, 32, (dir) => load(dir, off).catch(() => null));
    return found.filter((s): s is Skill => s !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function get(name: string): Promise<Skill> {
    // Skills are saved under skills/<name>/, so the folder is the fast path; scan only as a fallback.
    if (NAME.test(name) && existsSync(join(skillDir(name), 'SKILL.md'))) {
      const s = await load(skillDir(name), disabled()).catch(() => null);
      if (s?.name === name) return s;
    }
    const s = (await list()).find((x) => x.name === name);
    if (!s) throw new ToolError(`No skill called "${name}".`);
    return s;
  }

  /** Writes a validated skill (files already in memory) into skills/<name>/, replacing an older copy. */
  async function save(files: SkillFile[], enabled = true): Promise<Skill> {
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
    // Written beside the old copy first, so a failed write never leaves Sir without the skill.
    const dir = skillDir(meta.name);
    const staging = join(deps.root, `.installing-${meta.name}`); // dot folders aren't listed
    await rm(staging, { recursive: true, force: true });
    try {
      for (const file of files) {
        const target = inside(staging, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content, 'utf8');
      }
      if (!enabled) await writeFile(join(staging, OFF_MARKER), '', 'utf8');
      await rm(dir, { recursive: true, force: true });
      await rename(staging, dir);
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    return get(meta.name);
  }

  /** Reads one skill's chosen files and scans them. Returns the files, the scan verdict and Sir's notes. */
  async function installOne(
    refs: LazyFile[],
  ): Promise<{ name: string; files: SkillFile[]; risky: boolean; notes: string[] }> {
    const { keep, dropped } = pickSkillFiles(refs);
    const files = await inBatches(keep, DOWNLOADS_AT_ONCE, async (r) => ({
      path: r.path,
      content: await r.read(),
    }));
    const meta = parseSkillMd(files.find((x) => x.path === 'SKILL.md')?.content ?? '');
    const scan = scanForInjection(files.map((x) => x.content).join('\n'));
    const risky = isActionable(scan.severity);
    const notes: string[] = [];
    if (scan.severity !== 'none') {
      const advice = risky ? ' (installed turned off: read it before turning it on)' : '';
      notes.push(`"${meta.name}" ${scan.labels.join(', ')}${advice}.`);
    }
    if (dropped) notes.push(`"${meta.name}": left out ${dropped} large, binary or extra file(s).`);
    return { name: meta.name, files, risky, notes };
  }

  /**
   * Installs every skill in `groups` (skill folder → its files). One skill is turned on, as before;
   * several (a library) start turned off. A skill whose text tries to instruct the AI is always off.
   */
  async function installGroups(groups: Map<string, LazyFile[]>): Promise<InstallResult> {
    if (groups.size === 0)
      throw new JarvisError(
        'INVALID',
        'no SKILL.md',
        'No SKILL.md found there. Point at a skill folder, or a folder or repo that contains skills.',
      );
    if (groups.size > MAX_SKILLS_PER_INSTALL)
      throw new JarvisError(
        'INVALID',
        'too many skills',
        `That holds ${groups.size} skills; one install can add at most ${MAX_SKILLS_PER_INSTALL}. Link a sub-folder instead.`,
      );
    const many = groups.size > 1;
    const installed: Skill[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    let updated = 0;
    for (const [folder, refs] of groups) {
      const where = folder || 'the top folder';
      try {
        const one = await installOne(refs);
        if (seen.has(one.name)) {
          warnings.push(`Skipped ${where}: another skill here is also called "${one.name}".`);
          continue;
        }
        seen.add(one.name);
        warnings.push(...one.notes);
        // Updating a skill keeps Sir's on/off choice; a new library skill starts off.
        const before = existsSync(join(skillDir(one.name), 'SKILL.md'))
          ? await get(one.name).catch(() => null)
          : null;
        const enabled = !one.risky && (before ? before.enabled : !many);
        if (before) updated++;
        installed.push(await save(one.files, enabled));
      } catch (err) {
        if (!many) throw err;
        warnings.push(`Skipped ${where}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (updated)
      warnings.unshift(
        `${updated} skill(s) were already installed and were replaced with this copy (on/off kept; local edits to them are gone).`,
      );
    return { installed, warnings };
  }

  async function githubTree(owner: string, repo: string, ref: string): Promise<TreeEntry[]> {
    const res = await f(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok)
      throw new JarvisError(
        'NOT_FOUND',
        `github ${res.status}`,
        `GitHub answered ${res.status} for that link.`,
      );
    const tree = TreeSchema.parse(await res.json());
    if (tree.truncated)
      throw new JarvisError(
        'INVALID',
        'tree truncated',
        'That repository is too big to read in one go. Link the folder that holds the skills.',
      );
    return tree.tree;
  }

  return {
    list,
    get,
    /** Copies a skill folder, or every skill folder under it (text files only, size-limited). */
    async installFromFolder(folder: string): Promise<InstallResult> {
      const refs = await inBatches(await walk(folder), 32, async (rel) => ({
        path: rel,
        size: (await stat(join(folder, rel))).size,
        read: () => readFile(join(folder, rel), 'utf8'),
      }));
      return installGroups(groupBySkill(refs));
    },

    /**
     * github.com/<owner>/<repo>[/tree/<ref>/<path>] → the skill(s) at that path (public repos). One
     * call to the git trees API lists the files; contents come from raw.githubusercontent.com, so a
     * large library doesn't run into GitHub's 60-requests-an-hour API limit.
     */
    async installFromGitHub(url: string): Promise<InstallResult> {
      const m = GITHUB_URL.exec(url.trim());
      if (!m)
        throw new JarvisError(
          'INVALID',
          'bad url',
          'Use a GitHub link like https://github.com/owner/repo/tree/main/skills/my-skill',
        );
      const [, owner = '', repo = '', ref = 'HEAD', path = ''] = m;
      const root = decodeURIComponent(path.replace(/^\//, ''));
      const prefix = root ? `${root}/` : '';
      const raw = (p: string): string =>
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${p.split('/').map(encodeURIComponent).join('/')}`;
      const refs = (await githubTree(owner, repo, ref))
        .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
        .map((e) => ({
          path: e.path.slice(prefix.length),
          size: e.size ?? 0,
          read: async () => {
            const body = await f(raw(e.path), { signal: AbortSignal.timeout(30_000) });
            if (!body.ok) throw new Error(`couldn't download ${e.path} (${body.status})`);
            return body.text();
          },
        }));
      return installGroups(groupBySkill(refs));
    },

    async remove(name: string): Promise<void> {
      const s = await get(name);
      await rm(s.dir, { recursive: true, force: true });
    },

    setEnabled(name: string, enabled: boolean): void {
      const off = disabled();
      if (enabled) {
        off.delete(name);
        if (NAME.test(name)) rmSync(join(skillDir(name), OFF_MARKER), { force: true });
      } else off.add(name);
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
            if (!s.enabled)
              throw new ToolError(`The skill "${name}" is turned off in Settings → Skills.`);
            if (!TEXT.test(path)) throw new ToolError('Only text files in a skill can be read.');
            return ok(await readFile(inside(s.dir, path), 'utf8'));
          },
        }),
      ];
    },
  };
}

export type SkillStore = ReturnType<typeof createSkillStore>;
