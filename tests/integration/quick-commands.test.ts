import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemorySystem } from '@main/memory/memory-system';
import {
  createFakeRecorder,
  createFakeStt,
  createFakeTts,
  createFakeWake,
} from '@main/voice/fakes';
import { createVoiceSystem } from '@main/voice/voice-system';
import { idle, setupServices } from './helpers';

const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function setup(transcripts: string[]) {
  const t = setupServices({ rules: [] });
  const s = t.services;
  s.settings.set('onboarding.complete', true);
  s.settings.set('voice.mode', 'ptt');
  s.settings.set('voice.followUpSeconds', 0);
  const m = createMemorySystem(s);
  await m.start();
  writeFileSync(
    join(s.settings.get('vault.path'), 'Routines', 'Work Mode.md'),
    '---\nname: Work Mode\ntriggers: ["start work mode"]\nsteps:\n  - tool: open_url\n    input: { url: "https://github.com" }\n---\n',
  );
  await m.reloadRoutines();
  const stt = createFakeStt(transcripts);
  const v = createVoiceSystem(s, {
    factories: {
      recorder: (_d, n) => createFakeRecorder(n),
      wake: () => createFakeWake(),
      stt,
      edge: createFakeTts('edge'),
      sapi: createFakeTts('sapi'),
    },
    timeouts: { silenceMs: 300, maxListenMs: 3000, echoSettleMs: 10 },
  });
  await v.start();
  const chatCalls = (): number =>
    t.llm.calls.filter((c) => JSON.stringify(c.system).includes('You are JARVIS')).length;
  return { ...t, m, v, stt, chatCalls };
}

describe('instant voice commands (idea from Priler/jarvis)', () => {
  it('a routine trigger runs the routine through the policy with no model call', async () => {
    const t = await setup(['Jarvis, start work mode please.']);
    t.v.voice.ptt();
    await until(() => t.services.toolCalls.list(5).length >= 2);
    await idle(t.services);
    const ops = (t.services.os as unknown as { calls: Array<{ op: string }> }).calls;
    expect(ops.some((c) => c.op === 'openExternal')).toBe(true);
    expect(t.services.toolCalls.list(5).map((r) => r.tool_name)).toEqual(
      expect.arrayContaining(['run_routine', 'open_url']),
    );
    expect(t.chatCalls()).toBe(0);
    const reply = t.events.find(
      (e) =>
        e.event === 'chat:message' &&
        (e.payload as { message: { role: string } }).message.role === 'assistant',
    );
    expect(JSON.stringify(reply?.payload)).toContain('Running Work Mode');
    t.v.voice.shutdown();
    await t.m.watcher.stop();
  });

  it('"what time is it" is spoken at once without a conversation or model call', async () => {
    const t = await setup(['What time is it?']);
    t.v.voice.ptt();
    await until(() => t.events.some((e) => e.event === 'tts:audio'));
    expect(t.chatCalls()).toBe(0);
    expect(t.services.conversations.list(5)).toHaveLength(0);
    t.v.voice.shutdown();
    await t.m.watcher.stop();
  });

  it('can be switched off: the words then go to Claude', async () => {
    const t = await setup(['What time is it?']);
    t.services.settings.set('voice.quickCommands', false);
    t.v.voice.ptt();
    await until(() => t.services.conversations.list(5).length === 1);
    await idle(t.services);
    expect(t.chatCalls()).toBeGreaterThan(0);
    t.v.voice.shutdown();
    await t.m.watcher.stop();
  });
});
