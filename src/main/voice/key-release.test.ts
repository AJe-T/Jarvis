import { describe, expect, it } from 'vitest';
import { createFakeOs } from '../tools/native/os';
import { PS_WAIT_RELEASE, acceleratorKeys, waitForRelease } from './key-release';
import { vocabularyTerms } from './dictation';

describe('hold to talk', () => {
  it('turns Electron accelerators into the keys to poll', () => {
    expect(acceleratorKeys('Ctrl+Alt+D')).toEqual([0x11, 0x12, 0x44]);
    expect(acceleratorKeys('CommandOrControl+Shift+Space')).toEqual([0x11, 0x10, 0x20]);
    expect(acceleratorKeys('Super+F9')).toEqual([0x5b, 0x78]);
    expect(() => acceleratorKeys('Ctrl+MediaPlayPause')).toThrow(/Unknown key/);
  });

  it('polls the hotkey keys as parameters, never inside the script', async () => {
    const os = createFakeOs();
    await waitForRelease(os, 'Ctrl+Alt+D');
    expect(os.calls[0]).toEqual({
      op: 'ps',
      args: [PS_WAIT_RELEASE, { keys: [0x11, 0x12, 0x44], maxSeconds: 120 }],
    });
  });
});

describe('dictation vocabulary', () => {
  it('takes the written side of each fix and single-term lines, skipping comments', () => {
    expect(
      vocabularyTerms(
        'avan tech => AvaanTech\n# a note\n\nPriyanka\njar vis -> JARVIS\r\nAvaanTech',
      ),
    ).toEqual(['AvaanTech', 'Priyanka', 'JARVIS']);
  });

  it('caps the list and drops overlong terms', () => {
    const many = Array.from({ length: 80 }, (_, i) => `term${i}`).join('\n');
    expect(vocabularyTerms(many)).toHaveLength(50);
    expect(vocabularyTerms('x'.repeat(51))).toEqual([]);
  });
});
