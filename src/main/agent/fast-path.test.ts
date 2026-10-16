import { describe, expect, it, vi } from 'vitest';
import { logger } from '../logging/logger';
import { LAYA_ACTIONS, createFastPath, mathMatch, ruleMatch } from './fast-path';

describe('fast path rules', () => {
  it.each([
    ['Open Spotify', 'open_app', { name: 'spotify' }],
    ['Jarvis, could you launch notepad please?', 'open_app', { name: 'notepad' }],
    ['set the volume to 30%', 'set_volume', { level: 30 }],
    ['volume 75', 'set_volume', { level: 75 }],
    ['mute', 'mute', { muted: true }],
    ['unmute the sound', 'mute', { muted: false }],
    ['pause the music', 'media_control', { action: 'play_pause' }],
    ['skip this song', 'media_control', { action: 'next' }],
    ['previous track', 'media_control', { action: 'previous' }],
    ['lock my PC', 'lock_screen', {}],
  ])('%s → %s', (text, tool, input) => {
    expect(ruleMatch(text)).toMatchObject({ tool, input });
  });

  it.each([
    'open my downloads folder',
    'open notepad and type hello',
    'open the last file I edited',
    'volume 140',
    'start work mode',
    'what is the weather',
    'can you pause for a second and explain why the music industry changed after streaming',
  ])('leaves "%s" to Claude', (text) => {
    expect(ruleMatch(text)).toBeNull();
  });
});

describe('fast path with Laya', () => {
  const probs = (best: string, p: number): Record<string, number> =>
    Object.fromEntries(Object.keys(LAYA_ACTIONS).map((k) => [k, k === best ? p : (1 - p) / 5]));

  it('uses Laya only when it is sure, and only for short requests', async () => {
    const classify = vi.fn(async () => probs('next', 0.93));
    const fast = createFastPath({ mode: () => 'laya', classify, logger });
    expect(await fast('ugh this song is boring')).toMatchObject({
      tool: 'media_control',
      input: { action: 'next' },
    });
    classify.mockResolvedValueOnce(probs('next', 0.6));
    expect(await fast('hmm maybe something else')).toBeNull();
    classify.mockResolvedValueOnce(probs('other', 0.95));
    expect(await fast('tell me a joke')).toBeNull();
    classify.mockClear();
    expect(
      await fast('could you look through my notes from last week and tell me what I promised Ravi'),
    ).toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });

  it('never asks Laya when rules already know, or when off / rules-only', async () => {
    const classify = vi.fn(async () => probs('mute', 0.99));
    expect(
      await createFastPath({ mode: () => 'laya', classify, logger })('volume 20'),
    ).toMatchObject({
      tool: 'set_volume',
    });
    expect(await createFastPath({ mode: () => 'rules', classify, logger })('shh')).toBeNull();
    expect(await createFastPath({ mode: () => 'off', classify, logger })('mute')).toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });

  it('understands a custom assistant name in front', async () => {
    const fast = createFastPath({ mode: () => 'rules', assistantName: () => 'Summer', logger });
    expect(await fast('Summer, open Spotify')).toMatchObject({ input: { name: 'spotify' } });
  });

  it('falls back to Claude while Laya is loading', async () => {
    const fast = createFastPath({ mode: () => 'laya', classify: async () => null, logger });
    expect(await fast('shh')).toBeNull();
  });
});

describe('sums go straight to the calculator (ADR-040)', () => {
  it('shows the worked-out sum and says the answer, with no model call', () => {
    expect(mathMatch('What is 2+2?')).toEqual({
      tool: 'show_panel',
      input: { panel: { kind: 'calculator', expression: '2+2' } },
      ack: "That's 4, sir.",
    });
    expect(mathMatch('fifteen percent of 2400')?.ack).toBe("That's 360, sir.");
    expect(mathMatch('what is the capital of France')).toBeNull();
  });
});
