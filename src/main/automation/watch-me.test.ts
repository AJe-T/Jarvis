import { describe, expect, it } from 'vitest';
import { PRIVATE_TOOLS } from '@shared/free-pool';
import { logger } from '../logging/logger';
import type { ToolContext } from '../tools/types';
import {
  MAX_WATCH_SECONDS,
  WATCH_SCRIPT,
  createWatchMe,
  createWatchTools,
  describeTrail,
  type WatchEvent,
} from './watch-me';

const OWN_PID = 4242;
const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

function setup() {
  const fake = {
    seconds: 0,
    stopped: 0,
    emit: (_e: WatchEvent): void => undefined,
    end: (): void => undefined,
    notices: [] as string[],
  };
  const watch = createWatchMe({
    start: (seconds, onEvent, onEnd) => {
      fake.seconds = seconds;
      fake.emit = onEvent;
      fake.end = onEnd;
      return { stop: () => void fake.stopped++ };
    },
    ownPid: OWN_PID,
    notify: (m) => fake.notices.push(m),
  });
  const see = (e: Partial<WatchEvent>): void =>
    fake.emit({
      process: 'EXCEL',
      title: 'Budget.xlsx - Excel',
      pid: 7,
      hwnd: 1,
      control: '',
      kind: 'Pane',
      secret: false,
      ...e,
    });
  const tools = new Map(createWatchTools(watch).map((t) => [t.name, t]));
  const run = async (name: string): Promise<{ text: string; isError: boolean }> => {
    const out = await tools.get(name)!.run({}, ctx);
    return {
      text: out.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
      isError: out.isError === true,
    };
  };
  return { fake, watch, see, tools, run };
}

describe('teach by showing: watching', () => {
  it('notes each change of window or focused control once, in order', () => {
    const { fake, watch, see } = setup();
    expect(watch.begin()).toBe(true);
    expect(fake.seconds).toBe(MAX_WATCH_SECONDS);
    expect(watch.begin()).toBe(false); // already watching
    see({});
    see({ control: 'Insert', kind: 'TabItem' });
    see({ control: 'Insert', kind: 'TabItem' }); // the same again: not a new step
    see({ control: 'PivotTable', kind: 'Button' });
    see({ process: 'chrome', title: 'Bank statement - Google Chrome', kind: 'Document' });
    const trail = watch.end();
    expect(fake.stopped).toBe(1);
    expect(describeTrail(trail)).toBe(
      [
        '1. EXCEL — Budget.xlsx - Excel: Pane',
        '2. EXCEL — Budget.xlsx - Excel: TabItem "Insert"',
        '3. EXCEL — Budget.xlsx - Excel: Button "PivotTable"',
        '4. chrome — Bank statement - Google Chrome: Document',
      ].join('\n'),
    );
    expect(watch.end()).toEqual([]); // handed over once
  });

  it('never notes Jarvis itself, a private window title, or the name of a password field', () => {
    const { watch, see } = setup();
    watch.begin();
    see({ process: 'Jarvis', title: 'Passwords', pid: OWN_PID, control: 'Bank PIN' });
    see({ process: 'msedge', title: 'My bank - [InPrivate] - Microsoft Edge', control: 'Account' });
    see({ process: 'KeePassXC', title: 'vault.kdbx', control: 'Master key' });
    see({ process: 'chrome', title: 'Sign in', control: 'Password', kind: 'Edit', secret: true });
    see({ process: '', title: '' });
    expect(watch.end()).toEqual([
      { app: 'msedge', window: '', control: '', kind: 'Pane' },
      { app: 'KeePassXC', window: '', control: '', kind: 'Pane' },
      { app: 'chrome', window: 'Sign in', control: '', kind: 'password field' },
    ]);
  });

  it('keeps what it saw when the five minutes run out, and says so', async () => {
    const { fake, watch, see, run } = setup();
    watch.begin();
    see({ control: 'Save', kind: 'Button' });
    fake.end(); // the watcher process stopped by itself
    expect(watch.isWatching()).toBe(false);
    expect(fake.notices[0]).toMatch(/five minutes are up/);
    expect((await run('stop_watching')).text).toContain('Button "Save"');
  });

  it('the script records names only: no key state, no values, no screen', () => {
    expect(WATCH_SCRIPT).not.toMatch(
      /GetAsyncKeyState|GetKeyState|ValuePattern|TextPattern|CopyFromScreen/,
    );
    expect(WATCH_SCRIPT).toContain('IsPassword');
    expect(WATCH_SCRIPT).toContain('AddSeconds($SECONDS)');
  });
});

describe('watch_me and stop_watching tools', () => {
  it('watch_me asks first; stop_watching returns the trail as untrusted, private data', async () => {
    const { see, tools, run } = setup();
    expect(tools.get('watch_me')?.tier).toBe('CONFIRM');
    expect(tools.get('stop_watching')?.tier).toBe('SAFE');
    expect(tools.get('stop_watching')?.untrustedOutput).toBe(true);
    expect(PRIVATE_TOOLS['stop_watching']).toBe('screen');

    expect((await run('stop_watching')).isError).toBe(true); // not watching yet
    expect((await run('watch_me')).text).toMatch(/Watching now/);
    expect((await run('watch_me')).isError).toBe(true);
    expect((await run('stop_watching')).text).toMatch(/Nothing was seen/);

    await run('watch_me');
    see({ control: 'Insert', kind: 'TabItem' });
    const out = await tools.get('stop_watching')!.run({}, ctx);
    expect(out.untrustedSource).toBe('window and control names');
    expect(JSON.stringify(out.content)).toContain('TabItem \\"Insert\\"');
  });
});
