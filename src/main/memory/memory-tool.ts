import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ToolError } from '../errors';
import { nowIso, sha256 } from '../lib/util';
import type { AnthropicDefinedTool } from '../tools/registry';
import { defineTool, ok } from '../tools/types';
import { parseNote, stringifyNote } from './frontmatter';
import { inferKind } from './indexer';
import type { VaultService } from './vault-service';

const ROOT = '/memories';
const VP = z.string().min(1).max(400);

/** Claude memory tool (memory_20250818) commands, verified against @anthropic-ai/sdk 0.131.0 types. */
export const MemoryCommandSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('view'),
    path: VP,
    view_range: z.array(z.number().int()).length(2).optional(),
  }),
  z.object({ command: z.literal('create'), path: VP, file_text: z.string().max(200_000) }),
  z.object({
    command: z.literal('str_replace'),
    path: VP,
    old_str: z.string().min(1),
    new_str: z.string(),
  }),
  z.object({
    command: z.literal('insert'),
    path: VP,
    insert_line: z.number().int().min(0),
    insert_text: z.string(),
  }),
  z.object({ command: z.literal('delete'), path: VP }),
  z.object({ command: z.literal('rename'), old_path: VP, new_path: VP }),
]);
export type MemoryCommand = z.infer<typeof MemoryCommandSchema>;

/** '/memories/People/A.md' → 'Memory/People/A.md'. API-Guide.md §4 traversal protection is in vault.resolve. */
export function toVaultRel(virtualPath: string): string {
  const p = virtualPath.replace(/\\/g, '/');
  if (p !== ROOT && !p.startsWith(`${ROOT}/`)) throw new ToolError(`Path must start with ${ROOT}`);
  const rest = p.slice(ROOT.length).replace(/^\/+/, '');
  if (rest.split('/').some((s) => s === '..' || s === '.'))
    throw new ToolError('Path escapes the memory directory');
  return rest ? `Memory/${rest}` : 'Memory';
}

function requireMd(rel: string): void {
  if (!rel.toLowerCase().endsWith('.md'))
    throw new ToolError('Only .md files are allowed in memory');
}

function numbered(text: string, range?: number[]): string {
  const lines = text.split('\n');
  const [start = 1, endRaw = lines.length] = range ?? [];
  const end = endRaw === -1 ? lines.length : endRaw;
  return lines
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(6)}\t${l}`)
    .join('\n');
}

/** Adds the Database.md §8.2 frontmatter when Claude writes a bare note. */
function withFrontmatter(rel: string, text: string): string {
  const parsed = parseNote(text);
  if (Object.keys(parsed.frontmatter).length > 0) return text;
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? path.posix.basename(rel, '.md');
  return stringifyNote(
    {
      kind: inferKind(rel, {}),
      title,
      tags: [],
      created: nowIso(),
      updated: nowIso(),
      source: 'memory_tool',
    },
    text,
  );
}

export function createMemoryTool(
  vault: VaultService,
  onChange: (paths: string[]) => void,
): AnthropicDefinedTool {
  async function view(rel: string, range?: number[]): Promise<string> {
    const abs = vault.resolve(rel);
    if (!existsSync(abs))
      throw new ToolError(`The path ${rel.replace(/^Memory/, ROOT)} does not exist`);
    if (statSync(abs).isDirectory()) {
      const lines: string[] = [`Directory: ${rel.replace(/^Memory/, ROOT)}`];
      for (const e of await vault.list(rel)) {
        lines.push(`- ${e.path.replace(/^Memory/, ROOT)}${e.isDir ? '/' : ` (${e.size} bytes)`}`);
        if (e.isDir)
          for (const c of await vault.list(e.path))
            lines.push(
              `  - ${c.path.replace(/^Memory/, ROOT)}${c.isDir ? '/' : ` (${c.size} bytes)`}`,
            );
      }
      return lines.join('\n');
    }
    return numbered(await readFile(abs, 'utf8'), range);
  }

  async function run(cmd: MemoryCommand): Promise<string> {
    switch (cmd.command) {
      case 'view':
        return view(toVaultRel(cmd.path), cmd.view_range);
      case 'create': {
        const rel = toVaultRel(cmd.path);
        requireMd(rel);
        const r = await vault.write(rel, withFrontmatter(rel, cmd.file_text));
        onChange([rel]);
        return r.merged
          ? `Sir had edited ${cmd.path}; your text was appended under "Updates from Jarvis".`
          : `File created successfully at ${cmd.path}`;
      }
      case 'str_replace': {
        const rel = toVaultRel(cmd.path);
        requireMd(rel);
        const { raw, hash } = await vault.read(rel).catch(() => {
          throw new ToolError(`The path ${cmd.path} does not exist`);
        });
        const count = raw.split(cmd.old_str).length - 1;
        if (count === 0)
          throw new ToolError(
            `No match for old_str in ${cmd.path}. View the file and copy the exact text.`,
          );
        if (count > 1)
          throw new ToolError(
            `old_str appears ${count} times in ${cmd.path}; include more context so it is unique.`,
          );
        await vault.write(
          rel,
          raw.replace(cmd.old_str, () => cmd.new_str),
          { expectedHash: hash },
        );
        onChange([rel]);
        return `The memory file ${cmd.path} has been edited.`;
      }
      case 'insert': {
        const rel = toVaultRel(cmd.path);
        requireMd(rel);
        const { raw, hash } = await vault.read(rel).catch(() => {
          throw new ToolError(`The path ${cmd.path} does not exist`);
        });
        const lines = raw.split('\n');
        if (cmd.insert_line > lines.length)
          throw new ToolError(
            `insert_line ${cmd.insert_line} is past the end (${lines.length} lines).`,
          );
        lines.splice(cmd.insert_line, 0, cmd.insert_text);
        await vault.write(rel, lines.join('\n'), { expectedHash: hash });
        onChange([rel]);
        return `Text inserted at line ${cmd.insert_line} in ${cmd.path}.`;
      }
      case 'delete': {
        const rel = toVaultRel(cmd.path);
        if (rel === 'Memory') throw new ToolError('The memory root cannot be deleted.');
        await vault.trash(rel);
        onChange([rel]);
        return `${cmd.path} moved to the vault's .trash folder (recoverable in Obsidian).`;
      }
      case 'rename': {
        const from = toVaultRel(cmd.old_path);
        const to = toVaultRel(cmd.new_path);
        if (from === 'Memory' || to === 'Memory')
          throw new ToolError('The memory root cannot be renamed.');
        const fromAbs = vault.resolve(from);
        if (!existsSync(fromAbs)) throw new ToolError(`The path ${cmd.old_path} does not exist`);
        if (statSync(fromAbs).isFile()) requireMd(to);
        if (vault.exists(to)) throw new ToolError(`${cmd.new_path} already exists.`);
        const content = statSync(fromAbs).isFile() ? await readFile(fromAbs, 'utf8') : null;
        if (content === null)
          throw new ToolError(
            'Only files can be renamed; create the new folder by creating a file in it.',
          );
        await vault.write(to, content, { expectedHash: sha256(content) });
        await vault.trash(from);
        onChange([from, to]);
        return `Renamed ${cmd.old_path} to ${cmd.new_path}.`;
      }
    }
  }

  return {
    ...defineTool({
      name: 'memory',
      description: "Claude memory tool mapped to the Memory folder of sir's Obsidian vault.",
      input: MemoryCommandSchema,
      tier: 'SAFE',
      source: 'anthropic',
      summarize: (c) =>
        c.command === 'view'
          ? `Check memory ${c.path}`
          : c.command === 'rename'
            ? `Rename memory ${c.old_path}`
            : `${{ create: 'Save', str_replace: 'Update', insert: 'Update', delete: 'Forget' }[c.command]} memory ${c.path.replace(/^\/memories\/?/, '') || '/'}`,
      async run(cmd) {
        return ok(await run(cmd));
      },
    }),
    anthropicDefinition: { type: 'memory_20250818', name: 'memory' },
  };
}
