import { describe, expect, it } from 'vitest';
import { matchQuickCommand, normalizePhrase, similarity } from './quick-commands';

const routines = [
  { name: 'Work Mode', triggers: ['start work mode', 'work time'] },
  { name: 'Movie Night', triggers: ['movie night'] },
];
const at = new Date(2026, 9, 7, 14, 5);

describe('instant voice commands (idea from Priler/jarvis)', () => {
  it('strips the name, politeness and punctuation', () => {
    expect(normalizePhrase('Hey Jarvis, could you start work mode, please?')).toBe(
      'start work mode',
    );
    expect(normalizePhrase("What's the time now, sir?")).toBe('whats the time');
  });

  it('matches routine triggers, forgiving a misheard letter', () => {
    expect(matchQuickCommand('Jarvis, start work mode please.', routines)).toMatchObject({
      kind: 'routine',
      name: 'Work Mode',
    });
    expect(matchQuickCommand('start work mood', routines)).toMatchObject({ name: 'Work Mode' });
    expect(matchQuickCommand('Movie night!', routines)).toMatchObject({ name: 'Movie Night' });
  });

  it('leaves real questions for Claude', () => {
    expect(matchQuickCommand('how do I start work on the report', routines)).toBeNull();
    expect(matchQuickCommand('what time is the match tonight', routines)).toBeNull();
    expect(matchQuickCommand('', routines)).toBeNull();
  });

  it('answers time and date on the spot', () => {
    expect(matchQuickCommand('What time is it?', [], at)).toEqual({
      kind: 'say',
      text: "It's 2:05 pm, sir.",
    });
    expect(matchQuickCommand("Jarvis, what's the date today", [], at)).toEqual({
      kind: 'say',
      text: "It's Wednesday 7 October, sir.",
    });
  });

  it('similarity is 1 for equal strings and drops with edits', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7);
  });
});
