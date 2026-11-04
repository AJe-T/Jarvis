import { describe, expect, it } from 'vitest';
import { SETTINGS, type SettingKey } from '@shared/settings';
import { pickModel, turnWeight } from './model-router';
import { isPromptTooLong, lastClaudeModel } from './orchestrator';
import type { MessageRow } from '../db/repos/conversations-repo';

const settings = { get: <K extends SettingKey>(k: K) => SETTINGS[k].default } as never;
const manual = {
  get: <K extends SettingKey>(k: K) => (k === 'models.auto' ? false : SETTINGS[k].default),
} as never;

const FAST = 'claude-haiku-5-5';
const DEFAULT = 'claude-sonnet-5-5';
const DEEP = 'claude-opus-5-5';

describe('model router', () => {
  it.each([
    [{ purpose: 'chat' as const, text: 'Think hard about my week' }, DEEP],
    [{ purpose: 'chat' as const, text: 'help me plan the release' }, DEEP],
    [{ purpose: 'chat' as const, deep: true }, DEEP],
    [{ purpose: 'curator' as const }, FAST],
    [{ purpose: 'title' as const }, FAST],
    [{ purpose: 'summary' as const }, FAST],
    [{ purpose: 'desktop_agent' as const, text: 'think hard' }, DEFAULT],
    [{ purpose: 'task' as const, text: 'open notepad' }, DEFAULT],
  ])('%o → %s', (turn, model) => {
    expect(pickModel(settings, turn)).toBe(model);
  });

  it('does not treat "planet" as a deep trigger', () => {
    expect(pickModel(manual, { purpose: 'chat', text: 'how far is the planet Mars' })).toBe(
      DEFAULT,
    );
  });

  describe('auto (models.auto on)', () => {
    it.each([
      'open notepad',
      'Open YouTube',
      'hello jarvis, how are you?',
      'play some lofi music on youtube',
      'what time is it',
      'set a timer for ten minutes',
      'thanks',
    ])('talk and quick commands use the fast model: %s', (text) => {
      expect(pickModel(settings, { purpose: 'chat', text })).toBe(FAST);
    });

    it.each([
      'research the best laptops under 80k and compare them',
      'search the web for flights to Goa next Friday',
      'summarize this article for me',
      'write a python script that renames my photos',
      'why does my laptop overheat when charging',
      'debug the build error in my project',
      'what is the latest news on the elections',
    ])('real work uses the deep model: %s', (text) => {
      expect(pickModel(settings, { purpose: 'chat', text })).toBe(DEEP);
    });

    it('longer plain requests use the default model', () => {
      const text =
        'can you tell me a little bit about what the weather was like in Hyderabad over the weekend please';
      expect(pickModel(settings, { purpose: 'chat', text })).toBe(DEFAULT);
    });

    it('a very long request is real work', () => {
      expect(turnWeight(Array(70).fill('word').join(' '))).toBe('heavy');
    });

    it('"yes, do it" stays on the model that gave the last answer', () => {
      expect(pickModel(settings, { purpose: 'chat', text: 'yes do it', previous: DEEP })).toBe(
        DEEP,
      );
      expect(pickModel(settings, { purpose: 'chat', text: 'go ahead', previous: FAST })).toBe(FAST);
      expect(pickModel(settings, { purpose: 'chat', text: 'go ahead' })).toBe(DEFAULT);
    });

    it('"open VS Code" is a quick command, not coding', () => {
      expect(pickModel(settings, { purpose: 'chat', text: 'open VS Code' })).toBe(FAST);
    });
  });

  it('with auto off, chats keep the default model', () => {
    expect(pickModel(manual, { purpose: 'chat', text: 'open notepad' })).toBe(DEFAULT);
    expect(pickModel(manual, { purpose: 'chat', text: 'research laptops' })).toBe(DEFAULT);
  });
});

describe('lastClaudeModel', () => {
  const row = (role: 'user' | 'assistant', model: string | null): MessageRow =>
    ({ role, model }) as MessageRow;

  it('skips free-pool answers and user rows', () => {
    expect(
      lastClaudeModel([row('assistant', DEEP), row('assistant', 'pool:llama'), row('user', null)]),
    ).toBe(DEEP);
    expect(lastClaudeModel([row('user', null)])).toBeNull();
  });
});

describe('isPromptTooLong', () => {
  it("spots Claude's context-window rejection and nothing else", () => {
    expect(isPromptTooLong(new Error('Prompt is too long · the request is ~225859 tokens'))).toBe(
      true,
    );
    expect(isPromptTooLong(new Error('rate limited'))).toBe(false);
  });
});
