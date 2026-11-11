import { describe, expect, it } from 'vitest';
import { PRIVATE_TOOLS } from '@shared/free-pool';
import { migrate, openDatabase } from '../../db/connection';
import { logger } from '../../logging/logger';
import type { ForegroundWindow } from '../native/os';
import type { ToolContext } from '../types';
import { createScreenMemory, createScreenMemoryTool } from './screen-memory';

const OWN_PID = 4242;

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const state: {
    on: boolean;
    idle: number;
    excluded: string;
    keepDays: number;
    now: Date;
    win: ForegroundWindow;
    /** The window in front when the screenshot has been read (a switch mid-capture). */
    winAfter: ForegroundWindow | null;
    lines: string[];
    shots: number;
  } = {
    on: true,
    idle: 0,
    excluded: '',
    keepDays: 7,
    now: new Date(2026, 10, 11, 15, 0),
    win: { title: 'build log - Code', process: 'Code', hwnd: 1, pid: 10 },
    winAfter: null,
    lines: ['error TS2304: Cannot find name powerMonitor', 'at src/main/index.ts:265'],
    shots: 0,
  };
  let looks = 0;
  const memory = createScreenMemory({
    db,
    os: {
      captureScreen: () => {
        state.shots++;
        return Promise.resolve(new Uint8Array([1]));
      },
      psJson: <T>() => Promise.resolve({ lines: state.lines } as T),
      foregroundWindow: () => {
        looks++;
        return Promise.resolve(looks % 2 === 0 && state.winAfter ? state.winAfter : state.win);
      },
    },
    idleSeconds: () => state.idle,
    enabled: () => state.on,
    excluded: () => state.excluded,
    keepDays: () => state.keepDays,
    ownPid: OWN_PID,
    now: () => state.now,
  });
  /** Time passes, then Jarvis looks once. */
  const look = async (minutes = 0): Promise<string> => {
    state.now = new Date(state.now.getTime() + minutes * 60_000);
    looks = 0;
    return memory.capture();
  };
  return { db, state, memory, look };
}

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

describe('screen memory', () => {
  it('keeps the text on screen with its app and window, and finds it by its words', async () => {
    const { memory, look } = setup();
    expect(await look()).toBe('saved');
    const hits = memory.search('cannot find powermonitor');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ process: 'Code', title: 'build log - Code' });
    expect(hits[0]?.snippet).toContain('error TS2304: Cannot find name powerMonitor');
    expect(memory.search('nothing-like-this')).toEqual([]);
    expect(memory.text(hits[0]?.id ?? 0)).toContain('at src/main/index.ts:265');
  });

  it('reads the same window again only after five minutes, and keeps nothing that did not change', async () => {
    const { state, memory, look } = setup();
    await look();
    expect(await look(1)).toBe('skipped');
    expect(state.shots).toBe(1); // not even a screenshot
    expect(await look(5)).toBe('skipped'); // read again, same text: not kept twice
    expect(state.shots).toBe(2);
    state.lines = ['Build succeeded in 12 s, zero errors found'];
    expect(await look(5)).toBe('saved');
    expect(memory.count()).toBe(2);
  });

  it('never reads Jarvis, private windows, password managers, excluded apps, the lock screen, or while Sir is away or it is off', async () => {
    const { state, memory, look } = setup();
    const never: Array<Partial<ForegroundWindow>> = [
      { process: 'Jarvis', title: 'Passwords', pid: OWN_PID },
      { process: 'msedge', title: 'My bank - [InPrivate] - Microsoft Edge' },
      { process: 'chrome', title: 'New Incognito Tab - Google Chrome' },
      { process: 'KeePassXC', title: 'vault' },
      { process: 'LockApp', title: 'Windows Default Lock Screen' },
      { process: '', title: '' },
    ];
    for (const w of never) {
      state.win = { title: 't', process: 'p', hwnd: 2, pid: 11, ...w };
      expect(await look(10)).toBe('skipped');
    }
    state.excluded = 'WhatsApp.exe, mstsc';
    state.win = { title: 'Chat', process: 'whatsapp', hwnd: 3, pid: 12 };
    expect(await look(10)).toBe('skipped');
    state.win = { title: 'notes', process: 'notepad', hwnd: 4, pid: 13 };
    state.idle = 600;
    expect(await look(10)).toBe('skipped');
    state.idle = 0;
    state.on = false;
    expect(await look(10)).toBe('skipped');
    expect(state.shots).toBe(0);
    expect(memory.count()).toBe(0);
  });

  it('throws the capture away when Sir switched windows while the screen was being read', async () => {
    const { state, memory, look } = setup();
    state.winAfter = { title: 'My bank - [InPrivate]', process: 'msedge', hwnd: 9, pid: 20 };
    expect(await look()).toBe('skipped');
    expect(state.shots).toBe(1);
    expect(memory.count()).toBe(0);
  });

  it('blanks secrets before anything is written', async () => {
    const { state, memory, look } = setup();
    state.lines = ['Your card 4111 1111 1111 1111 was charged for the yearly plan'];
    await look();
    const kept = memory.text(memory.search('yearly plan')[0]?.id ?? 0) ?? '';
    expect(kept).not.toContain('4111 1111 1111 1111');
    expect(kept).toContain('yearly plan');
  });

  it('forgets captures older than the days Sir chose, and everything on clear', async () => {
    const { state, memory, look } = setup();
    await look();
    state.lines = ['a completely different screen of text here'];
    state.win = { title: 'other', process: 'notepad', hwnd: 5, pid: 14 };
    await look(8 * 24 * 60);
    memory.prune();
    expect(memory.count()).toBe(1);
    expect(memory.search('powermonitor')).toEqual([]);
    expect(memory.search('different', 5, '2026-11-19')).toHaveLength(1);
    expect(memory.search('different', 5, '2026-11-18')).toEqual([]);
    memory.clear();
    expect(memory.count()).toBe(0);
  });

  it('treats % and _ in a search as plain characters', async () => {
    const { state, memory, look } = setup();
    state.lines = ['disk usage is at 95% of the quota_limit value'];
    await look();
    expect(memory.search('95%')).toHaveLength(1);
    expect(memory.search('9_%')).toEqual([]);
  });
});

describe('screen_memory tool', () => {
  it('asks first, is private and untrusted, and answers with when, where and the text', async () => {
    const { state, memory, look } = setup();
    const tool = createScreenMemoryTool(memory, () => state.on);
    expect(tool.tier).toBe('CONFIRM');
    expect(tool.untrustedOutput).toBe(true);
    expect(PRIVATE_TOOLS['screen_memory']).toBe('screen');
    expect(tool.input.safeParse({ query: 'a' }).success).toBe(false);
    expect(tool.summarize({ query: 'error', limit: 5 })).toBe(
      'Search your screen memory for "error"',
    );

    state.on = false;
    const off = await tool.run(tool.input.parse({ query: 'error' }), ctx);
    expect(JSON.stringify(off.content)).toMatch(/Screen memory is off/);
    state.on = true;
    await look();
    const out = await tool.run(tool.input.parse({ query: 'TS2304' }), ctx);
    const text = out.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    expect(text).toContain('[2026-11-11 15:00] Code · build log - Code');
    expect(text).toContain('Cannot find name powerMonitor');
    expect(out.untrustedSource).toBe('the screen');
    const none = await tool.run(tool.input.parse({ query: 'zebra' }), ctx);
    expect(JSON.stringify(none.content)).toMatch(/Nothing on the screen mentioned/);
  });
});
