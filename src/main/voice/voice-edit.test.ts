import { describe, expect, it } from 'vitest';
import { MAX_SELECTION_CHARS, createVoiceEdit } from './voice-edit';

function setup() {
  const state = {
    selection: 'hey can u send the report',
    hwnd: 77,
    now: 1_000_000,
    pasted: [] as string[],
    copied: [] as string[],
    notices: [] as string[],
    asked: [] as Array<[string, string]>,
    reply: 'Could you please send the report?',
  };
  const edit = createVoiceEdit({
    os: {
      copySelection: () => Promise.resolve(state.selection),
      pasteText: (t) => {
        state.pasted.push(t);
        return Promise.resolve();
      },
      clipboardWrite: (t) => {
        state.copied.push(t);
        return Promise.resolve();
      },
      foregroundWindow: () =>
        Promise.resolve({ title: 'Mail', process: 'outlook', hwnd: state.hwnd, pid: 1 }),
    },
    rewrite: (selection, instruction) => {
      state.asked.push([selection, instruction]);
      return Promise.resolve(state.reply);
    },
    notify: (_level, message) => state.notices.push(message),
    now: () => state.now,
  });
  return { state, edit };
}

describe('voice edit of selected text', () => {
  it('copies the selection, rewrites it as told and pastes it over itself', async () => {
    const { state, edit } = setup();
    expect(await edit.begin()).toBe(true);
    expect(edit.isWaiting()).toBe(true);
    const p = edit.take();
    expect(p?.text).toBe('hey can u send the report');
    expect(edit.isWaiting()).toBe(false); // used once
    if (!p) throw new Error('no selection');
    expect(await edit.apply(p, 'make this formal')).toBe('Could you please send the report?');
    expect(state.asked).toEqual([['hey can u send the report', 'make this formal']]);
    expect(state.pasted).toEqual(['Could you please send the report?']);
  });

  it('does not start without a selection, with too much text, or with a secret in it', async () => {
    const { state, edit } = setup();
    state.selection = '   ';
    expect(await edit.begin()).toBe(false);
    expect(state.notices.at(-1)).toMatch(/Select some text first/);
    state.selection = 'x'.repeat(MAX_SELECTION_CHARS + 1);
    expect(await edit.begin()).toBe(false);
    expect(state.notices.at(-1)).toMatch(/too much text/);
    state.selection = 'my card is 4111 1111 1111 1111';
    expect(await edit.begin()).toBe(false);
    expect(state.notices.at(-1)).toMatch(/was not sent/);
    expect(edit.isWaiting()).toBe(false);
    expect(state.asked).toEqual([]);
  });

  it('forgets a selection that waited too long or was cancelled, so a later dictation is plain', async () => {
    const { state, edit } = setup();
    await edit.begin();
    state.now += 4 * 60_000;
    expect(edit.take()).toBeNull();
    await edit.begin();
    edit.cancel();
    expect(edit.take()).toBeNull();
  });

  it('puts the result on the clipboard, not into another window, if Sir switched windows', async () => {
    const { state, edit } = setup();
    await edit.begin();
    const p = edit.take();
    if (!p) throw new Error('no selection');
    state.hwnd = 99;
    await edit.apply(p, 'shorter');
    expect(state.pasted).toEqual([]);
    expect(state.copied).toEqual(['Could you please send the report?']);
    expect(state.notices.at(-1)).toMatch(/switched windows/);
  });

  it('fails loudly when the brain returns nothing, pasting nothing', async () => {
    const { state, edit } = setup();
    await edit.begin();
    const p = edit.take();
    if (!p) throw new Error('no selection');
    state.reply = '   ';
    await expect(edit.apply(p, 'shorter')).rejects.toThrow(/no text/);
    expect(state.pasted).toEqual([]);
  });
});
