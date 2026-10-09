import { describe, expect, it } from 'vitest';
import { captionOf } from './caption';

describe('captionOf', () => {
  it('drops spoken tags, Markdown marks, tables and code', () => {
    const text =
      '<spoken>Good evening, sir.</spoken> **All systems** ready.\n\n| A | B |\n|---|---|\n```ps\nGet-Process\n```';
    expect(captionOf(text)).toBe('Good evening, sir. All systems ready. A B');
  });

  it('keeps only the latest words of a long reply', () => {
    const out = captionOf('word '.repeat(200), 20);
    expect(out.startsWith('…')).toBe(true);
    expect(out.length).toBe(21);
  });
});
