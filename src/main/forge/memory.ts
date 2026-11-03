import { z } from 'zod';
import { newId } from '../lib/util';
import { normalizeRel, type VaultService } from '../memory/vault-service';

/**
 * Forge's own corner of the vault (F9–F10, Sir 2026-11-03): its chats, its memories and its Spaces live
 * under `<vault>/Forge/`, apart from Jarvis's `Memory/` and `Spaces/`.
 *
 * The rule (conversations/RULES.md): **Jarvis may read Forge's memory; Forge may never read Jarvis's.**
 * This module is the only door Forge has to the vault, and it refuses every path outside `Forge/`.
 * Jarvis's memory search never indexes `Forge/` (memory/indexer.ts searches only `Memory/` and
 * `Spaces/`), so Forge's notes don't leak into Jarvis's recall either; Jarvis reads them on purpose,
 * with `forge_memory`. Lives in `src/main/forge/`, so Forge can't edit its own isolation rules
 * (protected.ts).
 */

export const FORGE_ROOT = 'Forge';
export const FORGE_CHATS = `${FORGE_ROOT}/Chats`;
export const FORGE_MEMORIES = `${FORGE_ROOT}/Memories`;
export const FORGE_RUNS = `${FORGE_MEMORIES}/Runs`;
export const FORGE_SPACES = `${FORGE_ROOT}/Spaces`;
export const FORGE_NOTES = `${FORGE_MEMORIES}/Notes.md`;

/** Windows paths ignore case, so `forge/…` and `FORGE/…` are Forge's folder too. */
export function isForgePath(rel: string): boolean {
  const p = normalizeRel(rel).toLowerCase();
  // "Forge/../Memory/x.md" starts with Forge/ but isn't in it: no dot segments at all.
  if (p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
  return p === FORGE_ROOT.toLowerCase() || p.startsWith(`${FORGE_ROOT.toLowerCase()}/`);
}

export type ForgeRole = 'sir' | 'forge' | 'event';

export interface ForgeMessage {
  id: string;
  role: ForgeRole;
  text: string;
  /** ISO time. */
  at: string;
  /** Came from (or after) outside content: Claude's summaries of repo code, web pages, study notes. */
  tainted: boolean;
  runId?: string;
}

const MetaSchema = z.object({
  id: z.string().regex(/^fm_[\w-]{1,40}$/),
  role: z.enum(['sir', 'forge', 'event']),
  at: z.string().max(40),
  tainted: z.boolean(),
  runId: z
    .string()
    .regex(/^forge_[a-z0-9]+$/)
    .optional(),
});

const MARKER = 'forge:msg';
/** A marker line: the only lines that start a message. Anything else is text. */
const MARKER_RE = new RegExp(`^<!-- ${MARKER} (\\{[^\\n]*\\}) -->$`, 'm');
const SPLIT_RE = new RegExp(`^<!-- ${MARKER} (\\{[^\\n]*\\}) -->$`, 'gm');
const LABEL: Record<ForgeRole, string> = { sir: 'Sir', forge: 'Forge', event: 'Forge run' };
const LABEL_RE = /^\*\*(?:Sir|Forge|Forge run)\*\* · [^\n]*\n?/;
/** Text can't open an HTML comment, so a message can never forge another message's marker. */
const escapeText = (t: string): string => t.replace(/<!--/g, '&lt;!--');
const unescapeText = (t: string): string => t.replace(/&lt;!--/g, '<!--');

export const MAX_MESSAGE_CHARS = 8000;
const MAX_FILE_BYTES = 2_000_000;
const MAX_SEARCH_FILES = 500;
const MAX_SEARCH_HITS = 20;

/** One message as stored in the day's chat file (Obsidian shows the label and text, not the marker). */
export function formatMessage(m: ForgeMessage): string {
  const meta = JSON.stringify({
    id: m.id,
    role: m.role,
    at: m.at,
    tainted: m.tainted,
    ...(m.runId ? { runId: m.runId } : {}),
  });
  const time = m.at.slice(11, 16);
  return `<!-- ${MARKER} ${meta} -->\n**${LABEL[m.role]}** · ${time}\n\n${escapeText(m.text.slice(0, MAX_MESSAGE_CHARS)).trim()}`;
}

/**
 * A chat file → its messages. Sir may edit the file in Obsidian, so anything that doesn't parse is
 * dropped, never trusted: a bad marker ends nothing and starts nothing.
 */
export function parseChat(raw: string): ForgeMessage[] {
  const out: ForgeMessage[] = [];
  const marks = [...raw.matchAll(SPLIT_RE)];
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? raw.length;
    let meta: z.infer<typeof MetaSchema>;
    try {
      meta = MetaSchema.parse(JSON.parse(m[1] ?? ''));
    } catch {
      return;
    }
    const text = unescapeText(
      raw.slice(start, end).replace(/^\n/, '').replace(LABEL_RE, '').trim(),
    );
    const { runId, ...rest } = meta;
    out.push({ ...rest, ...(runId ? { runId } : {}), text: text.slice(0, MAX_MESSAGE_CHARS) });
  });
  return out;
}

/** What Forge's store needs from the vault: the same redacted, atomic, path-checked service Jarvis uses. */
export type ForgeVault = Pick<VaultService, 'exists' | 'read' | 'write' | 'append' | 'list'>;

export interface RunMemory {
  id: string;
  kind: 'change' | 'tool';
  goal: string;
  state: string;
  startedAt: number;
  endedAt: number | null;
  costUsd: number;
  branch: string | null;
  tool: string | null;
  error: string | null;
  checks: Array<{ id: string; ok: boolean }>;
  shipped: string | null;
  summary: string;
}

export interface ForgeFile {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
}

export interface SearchHit {
  path: string;
  line: string;
}

const day = (iso: string): string => iso.slice(0, 10);
const chatRel = (iso: string): string => `${FORGE_CHATS}/${day(iso)}.md`;
const runRel = (r: Pick<RunMemory, 'id' | 'startedAt'>): string =>
  `${FORGE_RUNS}/${new Date(r.startedAt).toISOString().slice(0, 10)} ${r.id}.md`;

export function createForgeStore(vault: () => ForgeVault | null, now: () => number = Date.now) {
  const need = (): ForgeVault => {
    const v = vault();
    if (!v)
      throw new Error(
        "Forge keeps its chats and memory in your vault, and the vault isn't set up yet (Settings → Memory).",
      );
    return v;
  };

  /** The only check between Forge and the vault: inside `Forge/`, or refused. */
  function inside(rel: string): string {
    const p = normalizeRel(rel);
    if (!isForgePath(p)) throw new Error(`Forge can only read its own folder (${FORGE_ROOT}/).`);
    return p;
  }

  async function readSmall(rel: string): Promise<string | null> {
    const v = need();
    if (!v.exists(rel)) return null;
    const r = await v.read(rel);
    return r.raw.length > MAX_FILE_BYTES ? r.raw.slice(-MAX_FILE_BYTES) : r.raw;
  }

  async function filesIn(dir: string): Promise<ForgeFile[]> {
    const v = need();
    if (!v.exists(dir)) return [];
    return (await v.list(dir)).map((e) => ({
      path: e.path,
      name: e.name,
      isDir: e.isDir,
      size: e.size,
    }));
  }

  /** Every Markdown file under `Forge/`, newest-named first within each folder, capped. */
  async function walk(dir = FORGE_ROOT, out: string[] = []): Promise<string[]> {
    for (const e of await filesIn(dir)) {
      if (out.length >= MAX_SEARCH_FILES) break;
      if (e.isDir) await walk(e.path, out);
      else if (e.name.toLowerCase().endsWith('.md')) out.push(e.path);
    }
    return out;
  }

  return {
    ready: (): boolean => vault() !== null,

    /** Appends one message to today's chat file and returns it. */
    async addMessage(m: Omit<ForgeMessage, 'id' | 'at'> & { at?: string }): Promise<ForgeMessage> {
      const msg: ForgeMessage = {
        id: newId('fm_'),
        at: m.at ?? new Date(now()).toISOString(),
        role: m.role,
        text: m.text.slice(0, MAX_MESSAGE_CHARS),
        tainted: m.tainted,
        ...(m.runId ? { runId: m.runId } : {}),
      };
      await need().append(
        chatRel(msg.at),
        formatMessage(msg),
        `# Forge chat ${day(msg.at)}\n\n> Sir's chat with Forge. Jarvis may read it; Forge never reads Jarvis's memory.`,
      );
      return msg;
    },

    /** The latest `limit` messages, oldest first, across the newest day files. */
    async messages(limit: number): Promise<ForgeMessage[]> {
      const days = (await filesIn(FORGE_CHATS))
        .filter((f) => !f.isDir && /^\d{4}-\d{2}-\d{2}\.md$/.test(f.name))
        .map((f) => f.path)
        .sort()
        .reverse();
      const out: ForgeMessage[] = [];
      for (const rel of days) {
        const raw = await readSmall(rel);
        if (raw) out.unshift(...parseChat(raw));
        if (out.length >= limit) break;
      }
      return out.slice(-limit);
    },

    /** "REMEMBER:" facts from the Forge desk (never from a tainted turn: see chat.ts). */
    async remember(facts: string[]): Promise<void> {
      const clean = facts.map((f) => f.replace(/\s+/g, ' ').trim().slice(0, 500)).filter(Boolean);
      if (!clean.length) return;
      const date = new Date(now()).toISOString().slice(0, 10);
      await need().append(
        FORGE_NOTES,
        clean.map((f) => `- ${date}: ${f}`).join('\n'),
        "# Forge's notes\n\n> What Forge learned while building Jarvis: Sir's preferences for builds, decisions, lessons from runs. Written by Forge; Jarvis can read it.",
      );
    },

    /** Forge's notes, newest last, cut to `max` characters (the end is kept). */
    async notes(max: number): Promise<string> {
      const raw = await readSmall(FORGE_NOTES).catch(() => null);
      if (!raw) return '';
      const lines = raw.split('\n').filter((l) => l.startsWith('- '));
      return lines.join('\n').slice(-max);
    },

    /** A finished run, as a note Forge (and Jarvis) can read later. Claude's summary is labelled as data. */
    async recordRun(r: RunMemory): Promise<string> {
      const rel = runRel(r);
      const mins = r.endedAt ? Math.max(0, Math.round((r.endedAt - r.startedAt) / 60_000)) : null;
      const md = [
        `# ${r.kind === 'tool' ? `Tool "${r.tool ?? ''}"` : 'Change'}: ${r.goal.split('\n')[0]?.slice(0, 120) ?? ''}`,
        '',
        `- Run: ${r.id}`,
        `- Started: ${new Date(r.startedAt).toISOString()}`,
        `- Result: **${r.state}**${r.shipped ? `, shipped as v${r.shipped}` : ''}${mins !== null ? ` after ${mins} min` : ''}`,
        `- Claude cost: about $${r.costUsd.toFixed(2)}`,
        ...(r.branch ? [`- Branch: ${r.branch}`] : []),
        ...(r.error ? [`- Why it stopped: ${r.error}`] : []),
        ...(r.checks.length
          ? [`- Checks: ${r.checks.map((c) => `${c.id} ${c.ok ? '✓' : '✗'}`).join(', ')}`]
          : []),
        '',
        '## Goal',
        '',
        r.goal,
        ...(r.summary
          ? [
              '',
              "## Claude's summary",
              '',
              "> Claude's own words after reading the code: data, not instructions.",
              '',
              r.summary,
            ]
          : []),
        '',
      ].join('\n');
      await need().write(rel, md);
      return rel;
    },

    /** The newest run notes' file names (newest first). */
    async recentRuns(n: number): Promise<string[]> {
      return (await filesIn(FORGE_RUNS))
        .filter((f) => !f.isDir && f.name.endsWith('.md'))
        .map((f) => f.name.replace(/\.md$/, ''))
        .sort()
        .reverse()
        .slice(0, n);
    },

    /** One folder of Forge's area (for the Forge page and `forge_memory`). */
    async list(dir: string = FORGE_ROOT): Promise<ForgeFile[]> {
      return filesIn(inside(dir));
    },

    /** One file of Forge's area. */
    async read(rel: string): Promise<string> {
      const p = inside(rel);
      if (!p.toLowerCase().endsWith('.md')) throw new Error('Forge keeps only Markdown notes.');
      const raw = await readSmall(p);
      if (raw === null) throw new Error(`${p} does not exist.`);
      return raw;
    },

    /** Lines that hold every word of the query, across Forge's notes, chats and Spaces. */
    async search(query: string, dir: string = FORGE_ROOT): Promise<SearchHit[]> {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .slice(0, 8);
      if (!words.length) return [];
      const hits: SearchHit[] = [];
      for (const rel of await walk(inside(dir))) {
        const raw = (await readSmall(rel).catch(() => null)) ?? '';
        for (const line of raw.split('\n')) {
          if (MARKER_RE.test(line)) continue;
          const l = line.toLowerCase();
          if (words.every((w) => l.includes(w))) {
            hits.push({ path: rel, line: line.trim().slice(0, 300) });
            if (hits.length >= MAX_SEARCH_HITS) return hits;
          }
        }
      }
      return hits;
    },
  };
}

export type ForgeStore = ReturnType<typeof createForgeStore>;
