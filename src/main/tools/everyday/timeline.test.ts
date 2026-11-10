import { describe, expect, it } from 'vitest';
import { PRIVATE_TOOLS } from '@shared/free-pool';
import { migrate, openDatabase } from '../../db/connection';
import { logger } from '../../logging/logger';
import type { ForegroundWindow } from '../native/os';
import type { ToolContext } from '../types';
import { createTimeline, createTimelineTool, duration } from './timeline';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const state: { on: boolean; idle: number; now: Date; win: ForegroundWindow } = {
    on: true,
    idle: 0,
    now: new Date(2026, 10, 11, 10, 0),
    win: { title: 'services.ts - Jarvis', process: 'Code', hwnd: 1, pid: 1 },
  };
  const timeline = createTimeline({
    db,
    foreground: () => Promise.resolve(state.win),
    idleSeconds: () => state.idle,
    enabled: () => state.on,
    now: () => state.now,
  });
  const see = async (process: string, title: string, times = 1): Promise<void> => {
    state.win = { title, process, hwnd: 1, pid: 1 };
    for (let i = 0; i < times; i++) await timeline.sample();
  };
  return { db, state, timeline, see };
}

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

describe('day timeline', () => {
  it('adds a minute per look to the app and window in front, most-used first', async () => {
    const { timeline, see } = setup();
    await see('Code', 'services.ts - Jarvis', 3);
    await see('Code', 'files.ts - Jarvis', 1);
    await see('chrome', 'Electron docs - Google Chrome', 2);
    const day = timeline.day();
    expect(day.day).toBe('2026-11-11');
    expect(day.totalSeconds).toBe(360);
    expect(day.apps.map((a) => [a.process, a.seconds])).toEqual([
      ['Code', 240],
      ['chrome', 120],
    ]);
    expect(day.apps[0]?.windows[0]).toEqual({ title: 'services.ts - Jarvis', seconds: 180 });
  });

  it('records nothing while it is off, while Sir is away, or on the lock screen', async () => {
    const { state, timeline, see } = setup();
    state.on = false;
    await see('Code', 'a');
    state.on = true;
    state.idle = 300;
    await see('Code', 'a');
    state.idle = 0;
    await see('LockApp', 'Windows Default Lock Screen');
    await see('', '');
    expect(timeline.day().apps).toEqual([]);
  });

  it('keeps private windows and password managers without their title, and cuts long titles', async () => {
    const { timeline, see } = setup();
    await see('msedge', 'My bank - [InPrivate] - Microsoft Edge');
    await see('KeePassXC', 'vault.kdbx - KeePassXC');
    await see('notepad', 'x'.repeat(300));
    const apps = timeline.day().apps;
    expect(apps.find((a) => a.process === 'msedge')?.windows).toEqual([]);
    expect(apps.find((a) => a.process === 'KeePassXC')?.windows).toEqual([]);
    expect(apps.find((a) => a.process === 'notepad')?.windows[0]?.title).toHaveLength(120);
  });

  it('deletes days older than 30 days, and everything on clear', async () => {
    const { db, state, timeline, see } = setup();
    await see('Code', 'old');
    state.now = new Date(2026, 11, 20, 10, 0);
    await see('Code', 'new');
    timeline.prune();
    const days = (db.prepare('SELECT day FROM app_usage').all() as Array<{ day: string }>).map(
      (r) => r.day,
    );
    expect(days).toEqual(['2026-12-20']);
    timeline.clear();
    expect(timeline.day().apps).toEqual([]);
  });

  it('formats durations', () => {
    expect(duration(300)).toBe('5 min');
    expect(duration(4980)).toBe('1 h 23 min');
  });
});

describe('day_timeline tool', () => {
  it('is safe, private and untrusted; reports a day and says when the timeline is off', async () => {
    const { state, timeline, see } = setup();
    const tool = createTimelineTool(timeline, () => state.on);
    expect(tool.tier).toBe('SAFE');
    expect(tool.untrustedOutput).toBe(true);
    expect(PRIVATE_TOOLS['day_timeline']).toBe('screen');
    expect(tool.input.safeParse({ day: 'yesterday' }).success).toBe(false);
    expect(tool.summarize({ day: '2026-11-10', windows: false })).toBe(
      'Read the day timeline for 2026-11-10',
    );

    state.on = false;
    const off = await tool.run(tool.input.parse({}), ctx);
    expect(JSON.stringify(off.content)).toMatch(/day timeline is off/);
    state.on = true;
    const empty = await tool.run(tool.input.parse({ day: '2026-01-01' }), ctx);
    expect(JSON.stringify(empty.content)).toMatch(/Nothing was recorded on 2026-01-01/);

    await see('Code', 'services.ts - Jarvis', 65);
    const out = await tool.run(tool.input.parse({ windows: true }), ctx);
    const text = out.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    expect(text).toContain('2026-11-11: 1 h 5 min at the PC.');
    expect(text).toContain('- Code: 1 h 5 min');
    expect(text).toContain('· services.ts - Jarvis: 1 h 5 min');
    expect(out.untrustedSource).toBe('window titles');
  });
});
