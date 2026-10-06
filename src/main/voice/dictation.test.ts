import { describe, expect, it } from 'vitest';
import { applyDictionary, finishDictation, parseDictionary, removeFillers } from './dictation';

describe('dictation text', () => {
  it.each([
    ['um so I think uh we should ship it', 'So I think we should ship it'],
    ['Hello, um, world.', 'Hello, world.'],
    ['umbrella and uhuru stay', 'Umbrella and uhuru stay'],
    ['erm.', ''],
  ])('removeFillers(%s)', (input, out) => expect(removeFillers(input)).toBe(out));

  it('applies "heard => written" fixes on whole words only', () => {
    const rules = parseDictionary('# names\njarvis => JARVIS\navan tech -> AvaanTech\n\nbad line');
    expect(rules).toHaveLength(2);
    expect(applyDictionary('ask jarvis about avan tech, not jarvisx', rules)).toBe(
      'ask JARVIS about AvaanTech, not jarvisx',
    );
  });

  it('finishDictation combines both, each optional', () => {
    expect(
      finishDictation(' uh email jarvis ', { removeFillers: true, dictionary: 'jarvis => JARVIS' }),
    ).toBe('Email JARVIS');
    expect(finishDictation('uh hi', { removeFillers: false, dictionary: '' })).toBe('uh hi');
  });
});
