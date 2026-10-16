import { describe, expect, it } from 'vitest';
import { createLinePicker, WAKE_LINES } from './greetings';

describe('createLinePicker', () => {
  it('never repeats the previous line', () => {
    const pick = createLinePicker(WAKE_LINES, () => 0);
    const said = [pick(), pick(), pick()];
    expect(said[0]).not.toBe(said[1]);
    expect(said[1]).not.toBe(said[2]);
  });

  it('returns only lines from the list', () => {
    const pick = createLinePicker(['a', 'b']);
    for (let i = 0; i < 20; i++) expect(['a', 'b']).toContain(pick());
  });
});
