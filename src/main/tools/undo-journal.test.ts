import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../db/connection';
import { logger } from '../logging/logger';
import { createPlanner } from '../planner/planner';
import { createPathGuard } from '../security/path-guard';
import { createFileTools } from './native/files';
import { createFakeOs } from './native/os';
import type { Tool, ToolContext } from './types';
import { createUndoJournal, createUndoTool, undoablePlanner } from './undo-journal';

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

function files() {
  const docs = mkdtempSync(path.join(tmpdir(), 'jarvis-undo-'));
  const journal = createUndoJournal();
  const os = createFakeOs({ psJson: () => ({}), clipboard: '' });
  const tools = new Map(
    createFileTools({
      os,
      guard: createPathGuard({ allowedRoots: () => [docs], deniedPaths: () => [] }),
      roots: () => [docs],
      protectedPaths: () => [],
      undo: journal,
    }).map((t) => [t.name, t]),
  );
  const run = async (name: string, input: unknown): Promise<string> => {
    const tool = tools.get(name) as Tool;
    const out = await tool.run(tool.input.parse(input), ctx);
    return out.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  };
  const trashed = (): string[] =>
    os.calls.filter((c) => c.op === 'trashItem').map((c) => path.basename(String(c.args[0])));
  return { docs, journal, run, trashed };
}

describe('undo journal', () => {
  it('takes back the newest action first and forgets it, whether or not it worked', async () => {
    const j = createUndoJournal(() => 5);
    expect(await j.undoLast()).toBeNull();
    j.record('first', () => Promise.resolve('first undone'));
    j.record('second', () => Promise.reject(new Error('it changed since')));
    expect(j.last()).toMatchObject({ label: 'second', at: 5 });
    expect(j.list().map((e) => e.label)).toEqual(['second', 'first']);
    expect(await j.undoLast()).toEqual({ label: 'second', ok: false, result: 'it changed since' });
    expect(await j.undoLast()).toEqual({ label: 'first', ok: true, result: 'first undone' });
    expect(j.last()).toBeUndefined();
  });

  it('refuses when the action Sir was shown is no longer the newest, and keeps 30 at most', async () => {
    const j = createUndoJournal();
    j.record('a', () => Promise.resolve('a'));
    const shown = j.last()?.id ?? 0;
    j.record('b', () => Promise.resolve('b'));
    expect(await j.undoLast(shown)).toBeNull();
    expect(j.list()).toHaveLength(2);
    for (let i = 0; i < 40; i++) j.record(`n${i}`, () => Promise.resolve(''));
    expect(j.list()).toHaveLength(30);
    j.clear();
    expect(j.list()).toEqual([]);
  });
});

describe('undoing file changes', () => {
  it('a new file goes to the Recycle Bin; an overwrite gets its earlier contents back', async () => {
    const { docs, journal, run, trashed } = files();
    const file = path.join(docs, 'note.txt');
    await run('write_text_file', { path: file, content: 'first' });
    await run('write_text_file', { path: file, content: 'second', overwrite: true });
    expect(journal.list().map((e) => e.label)).toEqual(['Overwrite note.txt', 'Create note.txt']);
    expect((await journal.undoLast())?.result).toMatch(/earlier contents/);
    expect(readFileSync(file, 'utf8')).toBe('first');
    expect((await journal.undoLast())?.ok).toBe(true);
    expect(trashed()).toEqual(['note.txt']);
  });

  it('leaves a file alone when it was changed after Jarvis wrote it', async () => {
    const { docs, journal, run, trashed } = files();
    const file = path.join(docs, 'draft.txt');
    await run('write_text_file', { path: file, content: 'from Jarvis' });
    writeFileSync(file, 'Sir edited this');
    const done = await journal.undoLast();
    expect(done).toMatchObject({ ok: false });
    expect(done?.result).toMatch(/changed since/);
    expect(readFileSync(file, 'utf8')).toBe('Sir edited this');
    expect(trashed()).toEqual([]);
  });

  it('moves and renames go back; never onto something that took the old place', async () => {
    const { docs, journal, run } = files();
    const a = path.join(docs, 'a.txt');
    writeFileSync(a, 'x');
    mkdirSync(path.join(docs, 'Archive'));
    await run('move_path', { from: a, to: path.join(docs, 'Archive') });
    await run('rename_path', { path: path.join(docs, 'Archive', 'a.txt'), newName: 'b.txt' });
    expect((await journal.undoLast())?.ok).toBe(true); // rename back
    expect(existsSync(path.join(docs, 'Archive', 'a.txt'))).toBe(true);
    writeFileSync(a, 'something new at the old place');
    const blocked = await journal.undoLast(); // move back: refused
    expect(blocked?.ok).toBe(false);
    expect(blocked?.result).toMatch(/Something else is at/);
    expect(readFileSync(a, 'utf8')).toBe('something new at the old place');
    expect(existsSync(path.join(docs, 'Archive', 'a.txt'))).toBe(true);
  });

  it('a copy goes to the Recycle Bin, an empty new folder is removed, a filled one is kept', async () => {
    const { docs, journal, run, trashed } = files();
    const a = path.join(docs, 'a.txt');
    writeFileSync(a, 'x');
    const dir = path.join(docs, 'New');
    await run('create_folder', { path: dir });
    await run('copy_path', { from: a, to: dir });
    expect((await journal.undoLast())?.ok).toBe(true);
    expect(trashed()).toEqual(['a.txt']);
    // The fake Recycle Bin removes nothing, so the folder still holds the copy: it must be kept.
    const kept = await journal.undoLast();
    expect(kept?.ok).toBe(false);
    expect(kept?.result).toMatch(/has things in it/);
    expect(existsSync(dir)).toBe(true);

    const empty = path.join(docs, 'Empty');
    await run('create_folder', { path: empty });
    expect((await journal.undoLast())?.ok).toBe(true);
    expect(existsSync(empty)).toBe(false);
  });

  it('says honestly that a deleted file comes back only from the Recycle Bin', async () => {
    const { docs, journal, run } = files();
    const a = path.join(docs, 'a.txt');
    writeFileSync(a, 'x');
    await run('delete_to_recycle_bin', { paths: [a] });
    expect(journal.last()?.label).toBe('Move a.txt to the Recycle Bin');
    expect((await journal.undoLast())?.result).toMatch(/Open the Recycle Bin/);
  });
});

describe('undoing task and calendar changes', () => {
  function planner() {
    const db = openDatabase(':memory:');
    migrate(db);
    const real = createPlanner({ db, logger, deliver: () => undefined, onChange: () => undefined });
    const journal = createUndoJournal();
    return { real, journal, p: undoablePlanner(real, journal) };
  }

  it('an added task is removed, a changed one is put back, a deleted one returns', async () => {
    const { real, journal, p } = planner();
    const t = p.saveTodo({ title: 'Pay rent', dueDate: '2026-11-12' });
    p.saveTodo({ id: t.id, title: 'Pay rent and water', priority: 1 });
    expect((await journal.undoLast())?.result).toMatch(/back as it was/);
    expect(real.todo(t.id)).toMatchObject({ title: 'Pay rent', dueDate: '2026-11-12' });

    p.deleteTodo(t.id);
    expect(real.todos()).toHaveLength(0);
    expect((await journal.undoLast())?.ok).toBe(true);
    expect(real.todos().map((x) => x.title)).toEqual(['Pay rent']);

    const extra = p.saveTodo({ title: 'Extra' });
    expect((await journal.undoLast())?.result).toBe('Removed task "Extra".');
    expect(real.todo(extra.id)).toBeUndefined();
  });

  it('calendar events the same, and what Sir does through the plain planner is not journaled', async () => {
    const { real, journal, p } = planner();
    const ev = p.saveEvent({
      title: 'Dentist',
      start: '2026-11-12T16:00',
      end: '2026-11-12T17:00',
    });
    p.saveEvent({ id: ev.id, start: '2026-11-13T09:00', end: '2026-11-13T10:00' });
    await journal.undoLast();
    expect(real.event(ev.id)?.start).toBe('2026-11-12T16:00');
    p.deleteEvent(ev.id);
    await journal.undoLast();
    expect(real.events().map((e) => e.title)).toEqual(['Dentist']);

    journal.clear();
    real.saveTodo({ title: 'Sir added this himself' });
    expect(journal.last()).toBeUndefined();
  });
});

describe('undo_last_action tool', () => {
  it('asks first, showing what it will take back, and reports the outcome', async () => {
    const journal = createUndoJournal();
    const tool = createUndoTool(journal);
    expect(tool.tier).toBe('CONFIRM');
    expect(tool.input.safeParse({ extra: 1 }).success).toBe(false);
    const nothing = await tool.run({}, ctx);
    expect(JSON.stringify(nothing.content)).toMatch(/nothing to undo/);

    journal.record('Move report.pdf to Archive', () => Promise.resolve('Moved it back.'));
    expect(tool.summarize({})).toBe('Undo: Move report.pdf to Archive');
    expect(tool.confirm?.({})).toMatchObject({ details: 'Move report.pdf to Archive' });
    const done = await tool.run({}, ctx);
    expect(JSON.stringify(done.content)).toContain(
      'Undid \\"Move report.pdf to Archive\\". Moved it back.',
    );

    journal.record('Rename a to b', () => Promise.reject(new Error('a is no longer there.')));
    const failed = await tool.run({}, ctx);
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed.content)).toMatch(/Could not undo/);
  });
});
