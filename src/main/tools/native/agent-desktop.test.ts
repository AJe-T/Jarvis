import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import type { Tool, ToolContext } from '../types';
import {
  createAgentDesktop,
  findAgentDesktop,
  flattenRefs,
  notificationsOf,
  parseEnvelope,
  type ExecFn,
} from './agent-desktop';
import { createNotificationTools } from './notifications';
import { createFakeOs } from './os';
import { PS_LIST_WINDOWS } from './ps-scripts';
import { PS_UIA_ACT, createUiAutomationTools } from './ui-automation';

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

/** A fake agent-desktop: answers per command, records every argument list. */
function fakeAd(answers: Record<string, unknown>) {
  const calls: string[][] = [];
  const exec: ExecFn = async (_file, args) => {
    calls.push(args);
    const cmd = args.find((a) => !a.startsWith('-')) ?? '';
    const key = cmd === 'find' && args.includes('--exact') ? 'find-exact' : cmd;
    return JSON.stringify(answers[key] ?? { ok: false, error: { code: 'X', message: 'no' } });
  };
  return { calls, ad: createAgentDesktop({ path: () => 'C:/ad.exe', enabled: () => true, exec }) };
}

const byName = (tools: Tool[], name: string): Tool => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
};
const run = async (t: Tool, input: unknown): Promise<{ text: string; isError: boolean }> => {
  const out = await t.run(t.input.parse(input), ctx);
  return {
    text: out.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
    isError: out.isError ?? false,
  };
};

function uiTools(answers: Record<string, unknown>) {
  const os = createFakeOs({
    psJson: (script) => {
      if (script === PS_LIST_WINDOWS)
        return [{ Id: 42, ProcessName: 'notepad', MainWindowTitle: 'Untitled - Notepad' }];
      if (script === PS_UIA_ACT) return { ok: true, done: 'invoked', label: 'Save (Button)' };
      return { title: 'Notepad', items: [{ n: 'Save', t: 'Button', id: '', on: true, v: '' }] };
    },
  });
  const { ad, calls } = fakeAd(answers);
  return { tools: createUiAutomationTools(os, ad), os, calls };
}

describe('agent-desktop', () => {
  it('finds the npm-installed Windows program first, then agent-desktop.exe on PATH', () => {
    const npm = join('C:/Users/me/AppData/Roaming', 'npm', 'node_modules', 'agent-desktop', 'bin');
    const env = { APPDATA: 'C:/Users/me/AppData/Roaming', PATH: 'C:/tools;relative/dir' };
    expect(findAgentDesktop(env, (p) => p.startsWith(npm), 'x64')).toBe(
      join(npm, 'agent-desktop-win32-x64.exe'),
    );
    expect(findAgentDesktop(env, (p) => p === join('C:/tools', 'agent-desktop.exe'))).toBe(
      join('C:/tools', 'agent-desktop.exe'),
    );
    // A relative PATH entry is never searched.
    expect(findAgentDesktop(env, (p) => p.startsWith('relative'))).toBeNull();
  });

  it('reads the JSON envelope even after other output, and reports output it cannot read', () => {
    expect(parseEnvelope('note\n{"ok":true,"data":{"a":1}}').data).toEqual({ a: 1 });
    expect(parseEnvelope('garbage').error?.code).toBe('BAD_OUTPUT');
  });

  it('flattens only elements with a ref and a label, and finds notification lists', () => {
    const nodes = flattenRefs(
      {
        role: 'window',
        name: 'w',
        children: [
          { role: 'button', name: 'OK', ref_id: '@s1:e1' },
          { role: 'group', children: [{ role: 'textfield', value: 'hi', ref_id: '@s1:e2' }] },
          { role: 'button', ref_id: '@s1:e3' },
        ],
      },
      10,
    );
    expect(nodes.map((n) => n.ref_id)).toEqual(['@s1:e1', '@s1:e2']);
    expect(notificationsOf({ notifications: [{ index: 1, title: 'Hi' }] })).toHaveLength(1);
    expect(notificationsOf([{ index: 2 }])).toHaveLength(1);
    expect(notificationsOf({ other: 'x' })).toEqual([]);
  });

  it('is not available when switched off or not installed', () => {
    expect(createAgentDesktop({ path: () => null, enabled: () => true }).available()).toBe(false);
    expect(createAgentDesktop({ path: () => 'x', enabled: () => false }).available()).toBe(false);
  });
});

describe('UI tools with agent-desktop', () => {
  it('lists controls from its snapshot instead of the PowerShell query', async () => {
    const { tools, os, calls } = uiTools({
      snapshot: {
        ok: true,
        data: {
          tree: { role: 'window', children: [{ role: 'button', name: 'Save', ref_id: '@a:e1' }] },
        },
      },
    });
    const out = await run(byName(tools, 'list_ui_elements'), { window: 'notepad' });
    expect(out.text).toContain('1. button "Save"');
    expect(calls[0]).toEqual(['snapshot', '--app=notepad', '-i', '--compact']);
    expect(os.calls.filter((c) => c.op === 'psJson')).toHaveLength(1); // only the window list
  });

  it('falls back to PowerShell when agent-desktop fails', async () => {
    const { tools } = uiTools({});
    const out = await run(byName(tools, 'list_ui_elements'), { window: 'notepad' });
    expect(out.text).toContain('Button "Save"');
  });

  it('clicks the one exact match by its ref', async () => {
    const { tools, calls } = uiTools({
      'find-exact': {
        ok: true,
        data: { matches: [{ role: 'button', name: 'Save', ref_id: '@a:e1' }] },
      },
      click: { ok: true, data: {} },
    });
    const out = await run(byName(tools, 'click_ui_element'), { window: 'notepad', name: 'Save' });
    expect(out.text).toBe('Done: clicked Save (button).');
    expect(calls.at(-1)).toEqual(['click', '@a:e1']);
  });

  it('refuses a fuzzy match on a risky button that was not asked for by name', async () => {
    const { tools, calls } = uiTools({
      'find-exact': { ok: true, data: { matches: [] } },
      find: {
        ok: true,
        data: { matches: [{ role: 'button', name: 'Send mail', ref_id: '@a:e9' }] },
      },
    });
    const out = await run(byName(tools, 'click_ui_element'), { window: 'notepad', name: 'Mail' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('Send mail');
    expect(calls.some((a) => a[0] === 'click')).toBe(false);
  });

  it('never retries a click that may have landed', async () => {
    const { tools, os } = uiTools({
      'find-exact': {
        ok: true,
        data: { matches: [{ role: 'button', name: 'Save', ref_id: '@a:e1' }] },
      },
      click: {
        ok: false,
        error: {
          code: 'ACTION_FAILED',
          message: 'x',
          disposition: { delivery: 'delivered_unverified' },
        },
      },
    });
    const out = await run(byName(tools, 'click_ui_element'), { window: 'notepad', name: 'Save' });
    expect(out.isError).toBe(true);
    expect(os.calls.some((c) => c.args[0] === PS_UIA_ACT)).toBe(false);
  });
});

describe('notification tools', () => {
  it('lists notifications as outside content', async () => {
    const { ad, calls } = fakeAd({
      'list-notifications': {
        ok: true,
        data: {
          notifications: [
            { index: 1, app_name: 'Outlook', title: 'Lunch?', body: 'At 1', actions: ['Reply'] },
          ],
        },
      },
    });
    const t = byName(createNotificationTools(ad), 'list_notifications');
    const out = await t.run(t.input.parse({ app: 'Outlook' }), ctx);
    expect(out.untrusted).toBe(true);
    expect(out.content[0]).toEqual({
      type: 'text',
      text: '1. Outlook · Lunch? — At 1 [buttons: Reply]',
    });
    expect(calls[0]).toEqual(['--headed', 'list-notifications', '--limit', '20', '--app=Outlook']);
  });

  it('names the title with every change, and asks before pressing a button', async () => {
    const { ad, calls } = fakeAd({ 'notification-action': { ok: true, data: {} } });
    const tools = createNotificationTools(ad);
    const press = byName(tools, 'notification_action');
    expect(press.tier).toBe('CONFIRM');
    await run(press, { index: 1, title: '--headed', action: 'Snooze' });
    expect(calls[0]).toEqual([
      '--headed',
      'notification-action',
      '1',
      'Snooze',
      '--expected-title=--headed',
    ]);
    const dismiss = byName(tools, 'dismiss_notification');
    expect(() => dismiss.input.parse({ index: 1 })).toThrow();
    expect(typeof dismiss.tier === 'function' && dismiss.tier({ all: true })).toBe('CONFIRM');
  });
});
