import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import type { Tool, ToolContext } from '../types';
import { createFakeOs } from './os';
import { PS_LIST_WINDOWS } from './ps-scripts';
import {
  PS_FOCUS_INFO,
  PS_SEND_KEYS,
  PS_UIA_ACT,
  PS_UIA_LIST,
  chordTier,
  createUiAutomationTools,
  parseChord,
} from './ui-automation';

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

function setup(
  act: unknown = { ok: true, done: 'invoked', label: 'Save (Button)' },
  front: { process: string; password: boolean } = { process: 'notepad', password: false },
) {
  const os = createFakeOs({
    psJson: (script) => {
      if (script === PS_FOCUS_INFO) return front;
      if (script === PS_LIST_WINDOWS)
        return [
          { Id: 7, ProcessName: 'Jarvis', MainWindowTitle: 'Jarvis' },
          { Id: 42, ProcessName: 'notepad', MainWindowTitle: 'notes.txt - Notepad' },
        ];
      if (script === PS_UIA_LIST)
        return {
          title: 'notes.txt - Notepad',
          items: [{ n: 'File', t: 'MenuItem', id: '', on: true, v: '' }],
        };
      if (script === PS_UIA_ACT) return act;
      return {};
    },
  });
  const tools = new Map(createUiAutomationTools(os).map((t) => [t.name, t]));
  const run = async (name: string, input: unknown): Promise<string> => {
    const t = tools.get(name) as Tool;
    const out = await t.run(t.input.parse(input), ctx);
    return out.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  };
  const tierOf = (name: string, input: unknown): unknown => {
    const t = tools.get(name) as Tool;
    const parsed = t.input.parse(input);
    return typeof t.tier === 'function' ? t.tier(parsed) : t.tier;
  };
  return { os, run, tierOf };
}

describe('UI Automation tools', () => {
  it('parses keyboard chords and refuses dangerous ones', () => {
    expect(parseChord('ctrl+shift+s')).toEqual([0x11, 0x10, 0x53]);
    expect(parseChord('F5')).toEqual([0x74]);
    expect(() => parseChord('ctrl+banana')).toThrow(/Unknown key/);
    expect(chordTier('win+r')).toBe('BLOCKED');
    expect(chordTier('Ctrl+Alt+Del')).toBe('BLOCKED');
    expect(chordTier('alt+f4')).toBe('CONFIRM');
    expect(chordTier('ctrl+s')).toBe('SAFE');
    // Order doesn't matter, and the obvious bypasses are closed.
    expect(chordTier('r+win')).toBe('BLOCKED');
    expect(chordTier('delete+ctrl+alt')).toBe('BLOCKED');
    expect(chordTier('ctrl+shift+esc')).toBe('BLOCKED');
    expect(chordTier('f4+alt')).toBe('CONFIRM');
    expect(chordTier('win+d')).toBe('CONFIRM');
    expect(chordTier('enter')).toBe('CONFIRM');
  });

  it('lists controls of the matched window, passing parameters as data', async () => {
    const t = setup();
    expect(await t.run('list_ui_elements', { window: 'notepad' })).toContain('1. MenuItem "File"');
    const call = t.os.calls.find((c) => c.args[0] === PS_UIA_LIST);
    expect(call?.args[1]).toMatchObject({ pid: 42, max: 120 });
  });

  it('asks before clicking buttons that send, pay or delete', () => {
    const t = setup();
    expect(t.tierOf('click_ui_element', { window: 'x', name: 'Bluetooth' })).toBe('SAFE');
    expect(t.tierOf('click_ui_element', { window: 'x', name: 'Send' })).toBe('CONFIRM');
    expect(t.tierOf('click_ui_element', { window: 'x', name: 'Delete account' })).toBe('CONFIRM');
    expect(t.tierOf('set_ui_text', { window: 'x', name: 'Search', text: 'a', submit: true })).toBe(
      'CONFIRM',
    );
  });

  it('clicks, and explains when nothing matches or a field is a password', async () => {
    expect(await setup().run('click_ui_element', { window: 'notepad', name: 'Save' })).toBe(
      'Done: invoked Save (Button).',
    );
    expect(
      await setup({ ok: false, error: 'not found' }).run('click_ui_element', {
        window: 'notepad',
        name: 'Nope',
      }),
    ).toMatch(/list_ui_elements/);
    expect(
      await setup({ ok: false, error: 'password field' }).run('set_ui_text', {
        window: 'notepad',
        name: 'Password',
        text: 'x',
      }),
    ).toMatch(/never types passwords/);
  });

  it('pastes into focused controls without a value pattern and presses Enter on submit', async () => {
    const t = setup({ ok: true, done: 'focused', label: 'Message (Edit)' });
    await t.run('set_ui_text', { window: 'notepad', name: 'Message', text: 'hello', submit: true });
    expect(t.os.calls.some((c) => c.op === 'pasteText' && c.args[0] === 'hello')).toBe(true);
    expect(t.os.calls.find((c) => c.args[0] === PS_SEND_KEYS)?.args[1]).toEqual({
      pid: 42,
      keys: [0x0d],
    });
  });

  it('reports a missing window', async () => {
    expect(await setup().run('read_window_text', { window: 'photoshop' })).toMatch(
      /No open window/,
    );
  });

  it('never reads or drives Jarvis itself, nor types into password boxes', async () => {
    const jarvis = setup();
    await jarvis.run('read_window_text', { window: 'Jarvis' });
    expect(
      jarvis.os.calls.some((c) => (c.args[1] as { pid?: number } | undefined)?.pid === 7),
    ).toBe(false);
    const front = (process: string, password: boolean) => setup(undefined, { process, password });
    expect(await front('Jarvis', false).run('type_text', { text: 'x' })).toMatch(/Jarvis itself/);
    expect(await front('chrome', true).run('type_text', { text: 'x' })).toMatch(/password box/);
    expect(await setup().run('type_text', { text: 'hello' })).toBe('Typed.');
  });

  it('asks again when fuzzy matching lands on a risky control', async () => {
    const t = setup({ ok: false, error: 'risky', label: 'Send mail (Button)' });
    expect(await t.run('click_ui_element', { window: 'notepad', name: 'Mail' })).toMatch(
      /exact name/,
    );
    expect(t.tierOf('click_ui_element', { window: 'x', automationId: 'SendButton' })).toBe(
      'CONFIRM',
    );
  });
});
