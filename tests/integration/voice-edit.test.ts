import { describe, expect, it } from 'vitest';
import { createFakeOs } from '@main/tools/native/os';
import {
  createFakeRecorder,
  createFakeStt,
  createFakeTts,
  createFakeWake,
} from '@main/voice/fakes';
import { createVoiceSystem } from '@main/voice/voice-system';
import { setupServices } from './helpers';

const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** A voice system whose app in front has `selection` selected and whose mic hears `said`. */
function setup(selection: string, said: string[], reply = 'Could you please send the report?') {
  const t = setupServices(
    { rules: [{ match: 'Instruction:', steps: [{ text: reply }] }] },
    { os: createFakeOs({ selection }) },
  );
  const s = t.services;
  s.settings.set('voice.mode', 'off'); // like dictation, it works in every voice mode
  const v = createVoiceSystem(s, {
    factories: {
      recorder: (_d, n) => createFakeRecorder(n),
      wake: () => createFakeWake(),
      stt: createFakeStt(said),
      edge: createFakeTts('edge'),
      sapi: createFakeTts('sapi'),
    },
    timeouts: { silenceMs: 2000, dictationQuietMs: 50 },
  });
  const os = s.os as unknown as { calls: Array<{ op: string; args: unknown[] }> };
  const pasted = (): unknown[] =>
    os.calls.filter((c) => c.op === 'pasteText').map((c) => c.args[0]);
  const notices = (): string[] =>
    t.events
      .filter((e) => e.event === 'notify')
      .map((e) => (e.payload as { message: string }).message);
  return { ...t, s, v, os, pasted, notices };
}

describe('voice edit of selected text (2.69)', () => {
  it('edit hotkey → copies the selection → spoken instruction → the rewrite is pasted over it', async () => {
    const { s, v, os, pasted, llm } = setup('hey can u send the report', ['make this formal']);
    await v.editSelection();
    expect(os.calls.some((c) => c.op === 'copySelection')).toBe(true);
    await until(() => pasted().length === 1);
    expect(pasted()).toEqual(['Could you please send the report?']);
    // The selection reached the brain as data, with the spoken words as the instruction.
    const sent = JSON.stringify(llm.calls.at(-1)?.messages);
    expect(sent).toContain('Instruction: make this formal');
    expect(sent).toContain('untrusted_content source=\\"selected text\\"');
    expect(sent).toContain('hey can u send the report');
    await until(() => v.dictations.list().length === 1);
    expect(v.dictations.list()[0]).toMatchObject({
      raw_text: '(edit) make this formal',
      final_text: 'Could you please send the report?',
    });
    expect(s.conversations.list(5)).toHaveLength(0); // an edit never becomes a chat turn
    v.voice.shutdown();
  });

  it('does nothing but say so when no text is selected', async () => {
    const { v, pasted, notices, llm } = setup('', ['make this formal']);
    await v.editSelection();
    await new Promise((r) => setTimeout(r, 150));
    expect(notices().some((m) => /Select some text first/.test(m))).toBe(true);
    expect(pasted()).toEqual([]);
    expect(llm.calls).toHaveLength(0);
    v.voice.shutdown();
  });

  it('a plain dictation afterwards types the words: it is not taken for an edit', async () => {
    const { v, pasted } = setup('some selected words', ['shorter', 'buy milk tomorrow'], 'Words.');
    await v.editSelection();
    await until(() => pasted().length === 1);
    expect(pasted()[0]).toBe('Words.');
    v.dictate();
    await until(() => pasted().length === 2);
    expect(pasted()[1]).toBe('Buy milk tomorrow');
    v.voice.shutdown();
  });
});
