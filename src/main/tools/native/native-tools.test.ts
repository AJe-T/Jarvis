import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../db/connection';
import { createRemindersRepo } from '../../db/repos/reminders-repo';
import { logger } from '../../logging/logger';
import { createPathGuard } from '../../security/path-guard';
import { createScheduler } from '../../scheduler/scheduler';
import type { Tool, ToolContext, ToolOutput } from '../types';
import { createAppIndex } from './app-index';
import { createNativeTools } from './index';
import { createFakeOs } from './os';

const base = mkdtempSync(path.join(tmpdir(), 'jarvis-native-'));
const docs = path.join(base, 'Documents');
const menu = path.join(base, 'StartMenu', 'Programs');
mkdirSync(docs, { recursive: true });
mkdirSync(path.join(menu, 'Accessories'), { recursive: true });
for (const n of [
  'Visual Studio Code',
  'Google Chrome',
  'Spotify',
  'Uninstall Spotify',
  'Accessories\\Notepad',
])
  writeFileSync(path.join(menu, `${n}.lnk`), '');

function setup(psJson: (script: string) => unknown = () => ({})) {
  const os = createFakeOs({ psJson, clipboard: 'clip text' });
  const db = openDatabase(':memory:');
  migrate(db);
  const fired: string[] = [];
  const scheduler = createScheduler({
    repo: createRemindersRepo(db),
    logger,
    onFire: (r) => fired.push(r.text),
  });
  const guard = createPathGuard({ allowedRoots: () => [docs], deniedPaths: () => [] });
  const appIndex = createAppIndex(os, [menu]);
  const tools = new Map(
    createNativeTools({
      os,
      appIndex,
      guard,
      scheduler,
      roots: () => [docs],
      protectedPaths: () => [],
    }).map((t) => [t.name, t]),
  );
  return { os, tools, scheduler, fired, appIndex };
}

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

async function run(
  tools: Map<string, Tool>,
  name: string,
  input: unknown,
): Promise<ToolOutput & { text: string }> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const out = await tool.run(tool.input.parse(input), ctx);
  return { ...out, text: out.content.map((c) => (c.type === 'text' ? c.text : '')).join('') };
}

const tierOf = (tool: Tool | undefined, input: unknown): string => {
  if (!tool) return 'missing';
  return typeof tool.tier === 'function' ? tool.tier(tool.input.parse(input)) : tool.tier;
};

describe('native tool catalogue', () => {
  it('matches the Security.md §4.1 tier table', () => {
    const { tools } = setup();
    const expected: Record<string, string> = {
      get_datetime: 'SAFE',
      get_system_info: 'SAFE',
      get_battery: 'SAFE',
      list_open_windows: 'SAFE',
      list_installed_apps: 'SAFE',
      open_app: 'SAFE',
      open_url: 'SAFE',
      focus_window: 'SAFE',
      minimize_window: 'SAFE',
      maximize_window: 'SAFE',
      set_volume: 'SAFE',
      mute: 'SAFE',
      media_control: 'SAFE',
      set_brightness: 'SAFE',
      write_clipboard: 'SAFE',
      read_clipboard: 'CONFIRM',
      show_notification: 'SAFE',
      set_timer: 'SAFE',
      set_reminder: 'SAFE',
      create_folder: 'CONFIRM',
      write_text_file: 'CONFIRM',
      move_path: 'CONFIRM',
      rename_path: 'CONFIRM',
      copy_path: 'CONFIRM',
      delete_to_recycle_bin: 'CONFIRM',
      close_app: 'CONFIRM',
      lock_screen: 'SAFE',
      sleep_pc: 'CONFIRM',
      restart_pc: 'CONFIRM',
      shutdown_pc: 'CONFIRM',
      run_powershell: 'CONFIRM',
    };
    for (const [name, tier] of Object.entries(expected)) {
      const t = tools.get(name);
      expect(t, name).toBeDefined();
      if (t && typeof t.tier === 'string') expect(t.tier, name).toBe(tier);
    }
    for (const name of [
      'delete_to_recycle_bin',
      'close_app',
      'kill_process',
      'sleep_pc',
      'restart_pc',
      'shutdown_pc',
    ])
      expect(tools.get(name)?.destructive, name).toBeTruthy();
  });

  it('every tool has a description under ~80 words and a summary', () => {
    const { tools } = setup();
    for (const t of tools.values()) {
      expect(t.description.split(/\s+/).length, t.name).toBeLessThanOrEqual(85);
      expect(t.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

describe('system tools', () => {
  it('get_datetime and get_system_info report local facts', async () => {
    const { tools } = setup();
    expect((await run(tools, 'get_datetime', {})).text).toMatch(/\d{4}/);
    expect((await run(tools, 'get_system_info', {})).text).toMatch(/Memory: .* GB/);
  });

  it('get_battery handles desktops and charging laptops', async () => {
    expect((await run(setup(() => ({ present: false })).tools, 'get_battery', {})).text).toMatch(
      /no battery/,
    );
    expect(
      (await run(setup(() => ({ present: true, percent: 64, status: 2 })).tools, 'get_battery', {}))
        .text,
    ).toBe('Battery at 64%, charging.');
    expect(
      (
        await run(
          setup(() => ({ present: true, percent: 40, status: 1, minutes: 125 })).tools,
          'get_battery',
          {},
        )
      ).text,
    ).toMatch(/2 h 5 min left/);
  });

  it('set_volume passes the level as a parameter, never in the script text', async () => {
    const { tools, os } = setup(() => ({ level: 30 }));
    expect((await run(tools, 'set_volume', { level: 30 })).text).toBe('Volume is now 30%.');
    expect(os.calls[0]?.args[1]).toEqual({ level: 30 });
    expect(String(os.calls[0]?.args[0])).not.toContain('30');
  });

  it('mute, media keys, brightness, lock, restart', async () => {
    const { tools, os } = setup(() => ({ muted: true, supported: false }));
    expect((await run(tools, 'mute', {})).text).toBe('Sound muted.');
    await run(tools, 'media_control', { action: 'next' });
    expect(os.calls.some((c) => c.op === 'mediaKey' && c.args[0] === 'next')).toBe(true);
    expect((await run(tools, 'set_brightness', { level: 50 })).isError).toBe(true);
    await run(tools, 'lock_screen', {});
    await run(tools, 'restart_pc', {});
    await run(tools, 'shutdown_pc', {});
    await run(tools, 'sleep_pc', {});
    expect(os.calls.filter((c) => c.op === 'run').map((c) => c.args[0])).toEqual([
      'rundll32.exe',
      'shutdown.exe',
      'shutdown.exe',
    ]);
  });
});

describe('apps and windows', () => {
  it('fuzzy-matches everyday app names', async () => {
    const { appIndex } = setup(() => [
      { Name: 'Calculator', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    ]);
    expect((await appIndex.find('vs code'))?.name).toBe('Visual Studio Code');
    expect((await appIndex.find('chrome'))?.name).toBe('Google Chrome');
    expect((await appIndex.find('calculator'))?.launch.kind).toBe('appid');
    expect((await appIndex.find('notepad'))?.name).toBe('Notepad');
    expect(await appIndex.list()).not.toContain('Uninstall Spotify');
  });

  it('open_app launches shortcuts and Store apps, and suggests on a miss', async () => {
    const { tools, os } = setup(() => [
      { Name: 'Calculator', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    ]);
    expect((await run(tools, 'open_app', { name: 'VS Code' })).text).toBe(
      'Opened Visual Studio Code.',
    );
    expect(os.calls.find((c) => c.op === 'openPath')?.args[0]).toMatch(/Visual Studio Code\.lnk$/);
    await run(tools, 'open_app', { name: 'calculator' });
    expect(os.calls.find((c) => c.op === 'run')?.args).toEqual([
      'explorer.exe',
      'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
    ]);
    const miss = await run(tools, 'open_app', { name: 'zzqqxx' });
    expect(miss.isError).toBe(true);
  });

  it('window tools act on the best-matching window', async () => {
    const windows = [
      { Id: 11, ProcessName: 'chrome', MainWindowTitle: 'GitHub - Google Chrome' },
      { Id: 22, ProcessName: 'Spotify', MainWindowTitle: 'Spotify Premium' },
    ];
    const { tools, os } = setup((script) =>
      script.includes('MainWindowHandle -ne 0')
        ? windows
        : script.includes('CloseMainWindow')
          ? { closed: ['Spotify'] }
          : { ok: true },
    );
    expect((await run(tools, 'list_open_windows', {})).text).toContain(
      'chrome: GitHub - Google Chrome',
    );
    expect((await run(tools, 'focus_window', { name: 'Chrome' })).text).toMatch(
      /Switched to GitHub/,
    );
    expect(os.calls.at(-1)?.args[1]).toEqual({ pid: 11, action: 'focus' });
    expect((await run(tools, 'minimize_window', { name: 'spotify' })).text).toMatch(/Minimized/);
    expect((await run(tools, 'close_app', { name: 'Spotify' })).text).toMatch(
      /Asked Spotify to close/,
    );
    expect((await run(tools, 'focus_window', { name: 'zzz-nothing' })).isError).toBe(true);
  });

  it('kill_process refuses system processes', async () => {
    const { tools } = setup(() => [{ Id: 4, ProcessName: 'lsass', MainWindowTitle: '' }]);
    expect(tierOf(tools.get('kill_process'), { name: 'lsass.exe' })).toBe('BLOCKED');
    expect(tierOf(tools.get('kill_process'), { name: 'notepad' })).toBe('CONFIRM');
    expect((await run(tools, 'kill_process', { pid: 4 })).text).toMatch(/protected system process/);
  });
});

describe('file tools', () => {
  it('create, write, read, rename, copy, move, search, delete', async () => {
    const { tools, os } = setup();
    const dir = path.join(docs, 'Invoices');
    await run(tools, 'create_folder', { path: dir });
    expect(existsSync(dir)).toBe(true);
    const file = path.join(dir, 'march.txt');
    await run(tools, 'write_text_file', { path: file, content: 'total: 42' });
    expect(readFileSync(file, 'utf8')).toBe('total: 42');
    expect((await run(tools, 'write_text_file', { path: file, content: 'x' })).isError).toBe(true);
    expect((await run(tools, 'read_text_file', { path: file })).text).toBe('total: 42');
    await run(tools, 'rename_path', { path: file, newName: 'march-final.txt' });
    const renamed = path.join(dir, 'march-final.txt');
    expect(existsSync(renamed)).toBe(true);
    await run(tools, 'copy_path', { from: renamed, to: docs });
    expect(existsSync(path.join(docs, 'march-final.txt'))).toBe(true);
    const archive = path.join(docs, 'Archive');
    await run(tools, 'create_folder', { path: archive });
    await run(tools, 'move_path', { from: path.join(docs, 'march-final.txt'), to: archive });
    expect(existsSync(path.join(archive, 'march-final.txt'))).toBe(true);
    expect((await run(tools, 'search_files', { query: 'march final', ext: 'txt' })).text).toContain(
      'march-final.txt',
    );
    expect((await run(tools, 'search_files', { query: 'nothing-like-this' })).text).toMatch(
      /No files/,
    );
    const del = await run(tools, 'delete_to_recycle_bin', {
      paths: [renamed, path.join(docs, 'gone.txt')],
    });
    expect(del.text).toMatch(/Moved 1 item.*Not found/);
    expect(String(os.calls.find((c) => c.op === 'trashItem')?.args[0])).toMatch(/march-final.txt$/);
  });

  it('refuses binary files, big files and folders as text', async () => {
    const { tools } = setup();
    const bin = path.join(docs, 'a.bin');
    writeFileSync(bin, Buffer.from([1, 0, 2]));
    expect((await run(tools, 'read_text_file', { path: bin })).isError).toBe(true);
    expect((await run(tools, 'read_text_file', { path: docs })).isError).toBe(true);
    await expect(
      run(tools, 'read_text_file', { path: path.join(docs, 'missing.txt') }),
    ).rejects.toThrow(/Can't open/);
  });

  it('never deletes or moves an allowed root', async () => {
    const { tools } = setup();
    expect((await run(tools, 'delete_to_recycle_bin', { paths: [docs] })).text).toMatch(
      /protected/,
    );
    expect((await run(tools, 'move_path', { from: docs, to: path.join(docs, 'x') })).text).toMatch(
      /protected/,
    );
  });

  it('computes tiers for sensitive and executable files', () => {
    const { tools } = setup();
    expect(tierOf(tools.get('read_text_file'), { path: path.join(docs, '.env') })).toBe('CONFIRM');
    expect(tierOf(tools.get('read_text_file'), { path: path.join(docs, 'notes.txt') })).toBe(
      'SAFE',
    );
    expect(tierOf(tools.get('open_path'), { path: path.join(docs, 'setup.exe') })).toBe('BLOCKED');
    expect(tierOf(tools.get('open_path'), { path: path.join(docs, 'report.pdf') })).toBe('SAFE');
  });

  it('open_path opens documents', async () => {
    const { tools, os } = setup();
    writeFileSync(path.join(docs, 'report.pdf'), 'x');
    await run(tools, 'open_path', { path: path.join(docs, 'report.pdf') });
    expect(os.calls.some((c) => c.op === 'openPath')).toBe(true);
  });
});

describe('misc tools', () => {
  it('open_url, clipboard, notification', async () => {
    const { tools, os } = setup();
    await run(tools, 'open_url', { url: 'https://github.com/AvaanTech' });
    expect(os.calls.find((c) => c.op === 'openExternal')?.args[0]).toBe(
      'https://github.com/AvaanTech',
    );
    expect((await run(tools, 'read_clipboard', {})).text).toBe('clip text');
    await run(tools, 'write_clipboard', { text: 'hello' });
    expect((await run(tools, 'read_clipboard', {})).text).toBe('hello');
    await run(tools, 'show_notification', { title: 'Hi', body: 'there' });
    expect(os.calls.some((c) => c.op === 'notify')).toBe(true);
  });

  it('timers and reminders fire through the scheduler', async () => {
    const { tools, scheduler, fired } = setup();
    expect((await run(tools, 'set_timer', { seconds: 1, label: 'Tea' })).text).toMatch(/Timer set/);
    const soon = new Date(Date.now() + 60_000).toISOString();
    const r = await run(tools, 'set_reminder', { text: 'call the courier office', dueAt: soon });
    expect(r.text).toMatch(/Reminder set/);
    expect(
      (await run(tools, 'set_reminder', { text: 'x', dueAt: '2020-01-01T00:00:00Z' })).isError,
    ).toBe(true);
    expect((await run(tools, 'list_reminders', {})).text).toContain('call the courier office');
    const id = /id (r_[\w-]+)/.exec(r.text)?.[1] ?? '';
    expect((await run(tools, 'cancel_reminder', { id })).text).toBe('Reminder cancelled.');
    expect((await run(tools, 'cancel_reminder', { id })).isError).toBe(true);
    await new Promise((res) => setTimeout(res, 1100));
    scheduler.tick();
    expect(fired).toEqual(['Tea is done.']);
  });

  it('run_powershell reports exit code and output', async () => {
    const { tools } = setup();
    const out = await run(tools, 'run_powershell', {
      script: 'Get-Date',
      purpose: 'check the date',
    });
    expect(out.text).toMatch(/Exit code 0/);
    expect(tools.get('run_powershell')?.guards?.({ script: 'Get-Date', purpose: 'x' })).toEqual({
      script: 'Get-Date',
    });
  });
});
