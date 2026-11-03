import { describe, expect, it, vi } from 'vitest';
import { createForgeChat, eventFor, FORGE_DESK_TOOLS, isDeskTool, type DeskTurn } from './chat';
import type { ForgeRun } from './forge';
import { createForgeStore, type ForgeVault } from './memory';

function memVault(): ForgeVault & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    exists: (rel) => files.has(rel) || [...files.keys()].some((k) => k.startsWith(`${rel}/`)),
    read: (rel) => {
      const raw = files.get(rel) ?? '';
      return Promise.resolve({ frontmatter: {}, body: raw, raw, hash: '' });
    },
    write: (rel, md) => {
      files.set(rel, md);
      return Promise.resolve({ rel, merged: false, hash: '' });
    },
    append: (rel, text, header) => {
      files.set(rel, `${(files.get(rel) ?? header).trimEnd()}\n\n${text.trim()}\n`);
      return Promise.resolve();
    },
    list: (rel = '') =>
      Promise.resolve(
        [
          ...new Set(
            [...files.keys()]
              .filter((k) => k.startsWith(`${rel}/`))
              .map((k) => k.slice(rel.length + 1).split('/')[0] ?? ''),
          ),
        ].map((name) => ({
          path: `${rel}/${name}`,
          name,
          isDir: !files.has(`${rel}/${name}`),
          size: 0,
        })),
      ),
  };
}

const run = (over: Partial<ForgeRun> = {}): ForgeRun => ({
  id: 'forge_abc',
  kind: 'change',
  goal: 'Add a currency converter',
  approved: [],
  state: 'preparing',
  startedAt: Date.UTC(2026, 10, 3),
  log: [],
  workers: { free: 0, boss: 0 },
  ...over,
});

function setup(reply: (t: DeskTurn) => Promise<{ text: string; tainted: boolean }>) {
  const vault = memVault();
  const store = createForgeStore(() => vault);
  const announce = vi.fn();
  const onMessage = vi.fn();
  const turns: DeskTurn[] = [];
  const chat = createForgeChat({
    store,
    reply: (t) => {
      turns.push(t);
      return reply(t);
    },
    status: () => null,
    assistantName: () => 'Jarvis',
    onMessage,
    announce,
  });
  return { vault, store, chat, announce, onMessage, turns };
}

describe('the Forge desk is walled off from Jarvis (F9, rule 2026-11-03)', () => {
  it('gets only Forge tools: no memory, Spaces, files, web, NPCs, or handing work to itself', () => {
    for (const name of [
      'memory',
      'search_memory',
      'recall_earlier',
      'search_conversations',
      'spaces',
      'npc_memory',
      'read_file',
      'web_search',
      'forge_chat',
    ])
      expect(isDeskTool(name)).toBe(false);
    expect(FORGE_DESK_TOOLS.every((t) => t.startsWith('forge_'))).toBe(true);
    expect(isDeskTool('forge_start')).toBe(true);
    expect(isDeskTool('forge_memory')).toBe(true);
  });

  it("its prompt says it can't see Sir's memory, and holds only Forge's notes and chat", async () => {
    const { chat, store, turns } = setup(() => Promise.resolve({ text: 'Sure.', tainted: false }));
    await store.remember(['Sir prefers tools over core changes']);
    await chat.send('learn to convert currencies');
    await chat.idle();
    const t = turns[0];
    expect(t?.system).toContain("What you can't see, by design: Sir's personal memory");
    expect(t?.system).toContain('Sir prefers tools over core changes');
    expect(t?.prompt).toContain('Sir: learn to convert currencies');
    expect(t?.tainted).toBe(false);
  });
});

describe('Forge chat (F9)', () => {
  it("saves Sir's message, then the desk's reply, in Forge's own chat file", async () => {
    const { chat, vault, onMessage } = setup(() =>
      Promise.resolve({ text: 'A tool will do: no reinstall.', tainted: false }),
    );
    const mine = await chat.send('  learn to convert currencies ');
    expect(mine.role).toBe('sir');
    expect(mine.text).toBe('learn to convert currencies');
    await chat.idle();
    expect(onMessage.mock.calls.map((c) => (c[0] as { role: string }).role)).toEqual([
      'sir',
      'forge',
    ]);
    const files = [...vault.files.keys()];
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^Forge\/Chats\/\d{4}-\d{2}-\d{2}\.md$/);
    expect((await chat.messages()).map((m) => m.text)).toEqual([
      'learn to convert currencies',
      'A tool will do: no reinstall.',
    ]);
  });

  it('REMEMBER lines go to its notes and out of the reply; a tainted turn keeps nothing', async () => {
    let tainted = false;
    const { chat, store } = setup(() =>
      Promise.resolve({ text: 'Noted.\nREMEMBER: Sir wants ECB rates', tainted }),
    );
    await chat.send('use ECB rates');
    await chat.idle();
    expect((await chat.messages()).at(-1)?.text).toBe('Noted.');
    expect(await store.notes(1000)).toContain('Sir wants ECB rates');
    tainted = true;
    const before = await store.notes(1000);
    await chat.send('read the run summary');
    await chat.idle();
    expect(await store.notes(1000)).toBe(before);
    expect((await chat.messages()).at(-1)?.tainted).toBe(true);
  });

  it('speaks a short answer only for a spoken request', async () => {
    const { chat, announce } = setup(() =>
      Promise.resolve({ text: 'x'.repeat(1000), tainted: false }),
    );
    await chat.send('typed');
    await chat.idle();
    expect(announce).not.toHaveBeenCalled();
    await chat.send('spoken', 'voice');
    await chat.idle();
    expect(announce).toHaveBeenCalledOnce();
    expect((announce.mock.calls[0]?.[0] as string).length).toBeLessThanOrEqual(280);
  });

  it('a failed reply is said in the chat, and the next message still gets an answer', async () => {
    let n = 0;
    const { chat } = setup(() =>
      ++n === 1
        ? Promise.reject(new Error('Claude is not signed in'))
        : Promise.resolve({ text: 'Back.', tainted: false }),
    );
    await chat.send('one');
    await chat.send('two');
    await chat.idle();
    const texts = (await chat.messages()).map((m) => m.text);
    expect(texts).toContain("⚠️ I couldn't answer: Claude is not signed in");
    expect(texts.at(-1)).toBe('Back.');
  });
});

describe('runs in the chat (F9) and in memory (F10)', () => {
  it('posts the start, state changes and gates, not every step', () => {
    expect(eventFor(undefined, run())?.text).toMatch(/^▶ Started "Add a currency converter"/);
    expect(eventFor(run(), run({ state: 'installing' }))?.text).toContain('npm ci');
    expect(
      eventFor(run({ state: 'building' }), run({ state: 'building', log: ['Read src/a.ts'] })),
    ).toBeNull();
    expect(
      eventFor(run({ state: 'checking' }), run({ state: 'checking', log: ['Gate: typecheck'] }))
        ?.text,
    ).toBe('· Gate: typecheck');
  });

  it('a failure is tainted (it carries check output); a pass is not', () => {
    const failed = eventFor(
      run({ state: 'checking' }),
      run({ state: 'failed', error: 'the lint check failed' }),
    );
    expect(failed?.tainted).toBe(true);
    expect(failed?.text).toContain('the lint check failed');
    const passed = eventFor(
      run({ state: 'checking' }),
      run({ state: 'passed', branch: 'forge/x' }),
    );
    expect(passed).toEqual({
      text: expect.stringContaining('approve it') as string,
      tainted: false,
    });
  });

  it('a finished run becomes a memory note once; shipping updates it', async () => {
    const { chat, vault } = setup(() => Promise.resolve({ text: '', tainted: false }));
    chat.onRun(run());
    chat.onRun(run({ state: 'passed', endedAt: Date.UTC(2026, 10, 3, 0, 5) }));
    chat.onRun(run({ state: 'passed', endedAt: Date.UTC(2026, 10, 3, 0, 5) }));
    await new Promise((r) => setTimeout(r, 10));
    const note = 'Forge/Memories/Runs/2026-11-03 forge_abc.md';
    expect(vault.files.get(note)).toContain('Result: **passed**');
    const ship = { runId: 'forge_abc', goal: '', branch: 'b', head: 'h', done: [], at: 0 };
    chat.onRun(run({ state: 'passed', ship: { ...ship, state: 'running' } }));
    chat.onRun(run({ state: 'passed', ship: { ...ship, state: 'shipped', version: '2.51.0' } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(vault.files.get(note)).toContain('shipped as v2.51.0');
    const events = (await chat.messages()).filter((m) => m.role === 'event').map((m) => m.text);
    expect(events.filter((e) => e.startsWith('✅'))).toHaveLength(2);
  });
});
