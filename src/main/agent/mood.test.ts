import { describe, expect, it } from 'vitest';
import { createMoodFilter, parseMood, stripMood } from './mood';

function run(deltas: string[]): { text: string; moods: string[] } {
  const moods: string[] = [];
  const f = createMoodFilter((m) => moods.push(m));
  const text = deltas.map((d) => f.push(d)).join('') + f.flush();
  return { text, moods };
}

describe('mood filter', () => {
  it('takes a leading tag out of the stream, even split across deltas', () => {
    const r = run(['<mo', 'od>hap', 'py</mood>', 'Good morning, sir.']);
    expect(r).toEqual({ text: 'Good morning, sir.', moods: ['happy'] });
  });

  it('keeps the spoken block intact after the tag', () => {
    const r = run(['<mood>calm</mood>\n<spoken>Done.</spoken>']);
    expect(r).toEqual({ text: '<spoken>Done.</spoken>', moods: ['calm'] });
  });

  it('passes plain replies straight through', () => {
    expect(run(['Hello', ' there'])).toEqual({ text: 'Hello there', moods: [] });
    expect(run(['<spoken>Hi</spoken>'])).toEqual({ text: '<spoken>Hi</spoken>', moods: [] });
  });

  it('drops an unknown mood without reporting it', () => {
    expect(run(['<mood>furious</mood>Fine.'])).toEqual({ text: 'Fine.', moods: [] });
  });

  it('gives back a held prefix when the turn ends early', () => {
    expect(run(['<mo'])).toEqual({ text: '<mo', moods: [] });
  });

  it('only looks at the start of the turn', () => {
    expect(run(['Yes. ', '<mood>happy</mood>'])).toEqual({
      text: 'Yes. <mood>happy</mood>',
      moods: [],
    });
  });

  it('checks again after each model step (a tool step, then the answer)', () => {
    const moods: string[] = [];
    const f = createMoodFilter((m) => moods.push(m));
    const first = f.push('<mood>curious</mood>Let me look.') + f.flush();
    const second = f.push('<mood>happy</mood>Found it.') + f.flush();
    expect([first, second, moods]).toEqual(['Let me look.', 'Found it.', ['curious', 'happy']]);
  });

  it('strips tags anywhere for display', () => {
    expect(stripMood('<mood>amused</mood>Ha. <mood>calm</mood>Right.')).toBe('Ha. Right.');
    expect(parseMood(' Excited ')).toBe('excited');
    expect(parseMood('angry')).toBeNull();
  });
});
