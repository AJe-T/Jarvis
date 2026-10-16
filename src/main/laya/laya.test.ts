import { describe, expect, it, vi } from 'vitest';
import { logger } from '../logging/logger';
import type { Intent, JudgeContext } from '../voice/conversation';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLaya, loadDecider, type Decider, type LayaMode } from './laya';

const ctx: JudgeContext = { followUp: false, lastReply: '', heard: 'open notepad, Jarvis' };
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function setup(mode: LayaMode, jarvis: number | (() => never)) {
  const predict = vi.fn(async () => ({
    q: {
      probabilities:
        typeof jarvis === 'function'
          ? jarvis()
          : { jarvis, someone_else: Math.round((1 - jarvis) * 100) / 100 },
    },
  }));
  const decider: Decider = { predict };
  const laya = createLaya({
    modelDir: 'unused',
    mode: () => mode,
    logger,
    load: async () => decider,
  });
  const claude = vi.fn(async (): Promise<Intent> => ({ directed: true, query: 'open notepad' }));
  return { laya, predict, claude, judge: laya.gateJudge(claude) };
}

async function ready(laya: ReturnType<typeof createLaya>): Promise<void> {
  laya.warm();
  await flush();
}

describe('Laya gate on the intent judge', () => {
  it('off: only Claude decides', async () => {
    const { laya, predict, claude, judge } = setup('off', 0.01);
    await ready(laya);
    expect(await judge('[-0s] Jarvis, open notepad', ctx)).toEqual({
      directed: true,
      query: 'open notepad',
    });
    expect(claude).toHaveBeenCalledOnce();
    expect(predict).not.toHaveBeenCalled();
  });

  it('on: skips Claude when Laya is sure the speech is not for Jarvis', async () => {
    const { laya, claude, judge } = setup('on', 0.05);
    await ready(laya);
    const heard = 'I asked Jarvis yesterday';
    expect(await judge(`[-0s] ${heard}`, { ...ctx, heard })).toEqual({
      directed: false,
      query: '',
    });
    expect(claude).not.toHaveBeenCalled();
  });

  it('on: asks Claude when the speech may be for Jarvis', async () => {
    const { laya, claude, judge } = setup('on', 0.37);
    await ready(laya);
    expect((await judge('[-0s] Jarvis, open notepad', ctx)).directed).toBe(true);
    expect(claude).toHaveBeenCalledOnce();
  });

  it('on: Laya sees the newest phrase, plus what Jarvis just said inside the follow-up window', async () => {
    const { laya, predict, judge } = setup('on', 0.9);
    await ready(laya);
    await judge('[-4s] other talk\n[-0s] yes please', {
      followUp: true,
      lastReply: 'Shall I set a timer?',
      heard: 'yes please',
    });
    await judge('[-0s] Jarvis, open notepad', ctx);
    expect(predict.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { jarvis_just_said: 'Shall I set a timer?', utterance: 'yes please' },
      { utterance: 'open notepad, Jarvis' },
    ]);
  });

  it('on: a phrase that starts by naming Jarvis always goes to Claude', async () => {
    const { laya, predict, claude, judge } = setup('on', 0.01);
    await ready(laya);
    for (const heard of ['Jarvis, open notepad', 'hey Jarvis remind me', '...Jarvis?'])
      expect((await judge(`[-0s] ${heard}`, { ...ctx, heard })).directed).toBe(true);
    expect(claude).toHaveBeenCalledTimes(3);
    expect(predict).not.toHaveBeenCalled();
  });

  it('on: asks Claude while the model is still loading', async () => {
    const { claude, judge, predict } = setup('on', 0.01);
    expect((await judge('[-0s] Jarvis, open notepad', ctx)).directed).toBe(true);
    expect(claude).toHaveBeenCalledOnce();
    expect(predict).not.toHaveBeenCalled();
  });

  it('on: asks Claude when Laya fails', async () => {
    const { laya, claude, judge } = setup('on', () => {
      throw new Error('onnx exploded');
    });
    await ready(laya);
    expect((await judge('[-0s] Jarvis, open notepad', ctx)).directed).toBe(true);
    expect(claude).toHaveBeenCalledOnce();
  });

  it('on: a slow decision is dropped and Claude decides', async () => {
    vi.useFakeTimers();
    try {
      const claude = vi.fn(async (): Promise<Intent> => ({ directed: true, query: 'x' }));
      const laya = createLaya({
        modelDir: 'unused',
        mode: () => 'on',
        logger,
        load: async () => ({ predict: () => new Promise(() => undefined) }),
      });
      laya.warm();
      await vi.advanceTimersByTimeAsync(0);
      const result = laya.gateJudge(claude)('[-0s] Jarvis, hi', ctx);
      await vi.advanceTimersByTimeAsync(2000);
      expect((await result).directed).toBe(true);
      expect(claude).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shadow: runs both and keeps Claude's answer", async () => {
    const { laya, predict, claude, judge } = setup('shadow', 0.01);
    await ready(laya);
    expect((await judge('[-0s] Jarvis, open notepad', ctx)).directed).toBe(true);
    expect(claude).toHaveBeenCalledOnce();
    expect(predict).toHaveBeenCalledOnce();
  });

  it('never loads a model that is not installed', async () => {
    const laya = createLaya({ modelDir: 'C:/nowhere/laya', mode: () => 'on', logger });
    expect(laya.installed()).toBe(false);
    expect(await laya.addressed(ctx)).toBeNull();
  });
});

describe('loading the real model', () => {
  it('refuses a model file that does not match its pinned hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'laya-'));
    writeFileSync(join(dir, 'encoder.onnx'), 'not the real model');
    await expect(loadDecider(dir)).rejects.toThrow(/pinned hash/);
  });
});
