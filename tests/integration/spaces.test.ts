import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logger } from '@main/logging/logger';
import { buildGraph, extractLinks } from '@main/memory/graph';
import { createMemorySystem } from '@main/memory/memory-system';
import { createSpaces, createSpacesTool } from '@main/spaces/spaces';
import { setupServices } from './helpers';

async function setup() {
  const t = setupServices();
  const memory = createMemorySystem(t.services);
  await memory.vault.ensureSkeleton();
  const changed: string[] = [];
  const spaces = createSpaces({
    vault: memory.vault,
    settings: t.services.settings,
    onChanged: (p) => changed.push(...p),
  });
  return { ...t, memory, spaces, changed };
}

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

describe('Spaces', () => {
  it('creates spaces and template pages as Markdown in the vault, searchable by memory', async () => {
    const t = await setup();
    await t.spaces.create('Finance', '💰');
    const page = await t.spaces.createPage('Finance', 'October budget', 'finance');
    expect(page).toBe('October budget');
    const file = join(t.memory.vault.root(), 'Spaces', 'Finance', 'October budget.md');
    expect(readFileSync(file, 'utf8')).toContain('| Date | Item | Category | Amount |');
    expect(await t.spaces.createPage('Finance', 'October budget', 'blank')).toBe(
      'October budget 2',
    );

    const cur = await t.spaces.read('Finance', page);
    await t.spaces.write('Finance', page, `${cur.markdown}\nRent 25000 for the flat\n`, cur.hash);
    expect(t.memory.retriever.searchMemories('rent flat', 5)[0]?.vaultPath).toBe(
      'Spaces/Finance/October budget.md',
    );
    const list = await t.spaces.list();
    expect(list).toEqual([expect.objectContaining({ name: 'Finance', icon: '💰', pageCount: 2 })]);
  });

  it('renames and deletes pages and spaces (deletes go to the vault trash)', async () => {
    const t = await setup();
    await t.spaces.create('Learning', '📚');
    await t.spaces.createPage('Learning', 'Rust', 'learning');
    await t.spaces.renamePage('Learning', 'Rust', 'Rust ownership');
    expect((await t.spaces.pages('Learning')).map((p) => p.name)).toEqual(['Rust ownership']);
    await t.spaces.update('Learning', { name: 'Study', icon: '🎓' });
    expect((await t.spaces.list())[0]).toMatchObject({ name: 'Study', icon: '🎓' });
    await t.spaces.removePage('Study', 'Rust ownership');
    await t.spaces.remove('Study');
    expect(existsSync(join(t.memory.vault.root(), '.trash', 'Study'))).toBe(true);
    await expect(t.spaces.create('bad/name', '📁')).rejects.toMatchObject({
      userMessage: expect.stringMatching(/can't be used/) as unknown,
    });
  });

  it('lets Jarvis append to a page with the spaces tool (creating it if missing)', async () => {
    const t = await setup();
    const tool = createSpacesTool(t.spaces);
    const run = async (input: unknown): Promise<string> =>
      (await tool.run(tool.input.parse(input), ctx)).content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('');
    expect(
      await run({ action: 'append', space: 'Ideas', page: 'Apps', text: 'A plant app' }),
    ).toMatch(/Added/);
    await run({ action: 'append', space: 'Ideas', page: 'Apps', text: 'A budget bot' });
    const md = await run({ action: 'read_page', space: 'Ideas', page: 'Apps' });
    expect(md).toContain('A plant app');
    expect(md).toContain('A budget bot');
    expect(await run({ action: 'list_spaces' })).toContain('Ideas (1 pages)');
  });
});

describe('Brain graph', () => {
  it('reads [[wiki]] and Markdown links', () => {
    expect(
      extractLinks('See [[Pradyumna|P]] and [[Jarvis#Plan]] and [x](Other%20Note.md)'),
    ).toEqual(['Pradyumna', 'Jarvis', 'Other Note']);
  });

  it('connects notes by links and to folder hubs', async () => {
    const t = await setup();
    await t.memory.vault.write('Memory/People/Pradyumna.md', '# Pradyumna\nWorks on [[Jarvis]].');
    await t.memory.vault.write('Memory/Projects/Jarvis.md', '# Jarvis\nBuilt with [[Pradyumna]].');
    const g = await buildGraph(t.memory.vault);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain('Memory/People/Pradyumna.md');
    expect(ids).toContain('folder:Memory/People');
    expect(ids).toContain('folder:.');
    const links = g.links.filter((l) => l.kind === 'link');
    expect(links).toHaveLength(1); // the two-way link counts once
    expect(g.nodes.find((n) => n.id === 'Memory/Projects/Jarvis.md')?.group).toBe(
      'Memory/Projects',
    );
  });
});
