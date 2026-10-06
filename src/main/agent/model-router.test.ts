import { describe, expect, it } from 'vitest';
import { SETTINGS, type SettingKey } from '@shared/settings';
import { pickModel } from './model-router';

const settings = { get: <K extends SettingKey>(k: K) => SETTINGS[k].default } as never;

describe('model router', () => {
  it.each([
    [{ purpose: 'chat' as const, text: 'open notepad' }, 'claude-sonnet-5-5'],
    [{ purpose: 'chat' as const, text: 'Think hard about my week' }, 'claude-opus-5-5'],
    [{ purpose: 'chat' as const, text: 'help me plan the release' }, 'claude-opus-5-5'],
    [{ purpose: 'chat' as const, deep: true }, 'claude-opus-5-5'],
    [{ purpose: 'curator' as const }, 'claude-haiku-4-5-20251001'],
    [{ purpose: 'title' as const }, 'claude-haiku-4-5-20251001'],
    [{ purpose: 'summary' as const }, 'claude-haiku-4-5-20251001'],
    [{ purpose: 'desktop_agent' as const, text: 'think hard' }, 'claude-sonnet-5-5'],
  ])('%o → %s', (turn, model) => {
    expect(pickModel(settings, turn)).toBe(model);
  });

  it('does not treat "planet" as a deep trigger', () => {
    expect(pickModel(settings, { purpose: 'chat', text: 'how far is the planet Mars' })).toBe(
      'claude-sonnet-5-5',
    );
  });
});
