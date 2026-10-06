import { describe, expect, it } from 'vitest';
import { SentenceChunker, SpokenExtractor, escapeSsml, stripMarkdown } from './speech';

function chunkAll(parts: string[]): string[] {
  const c = new SentenceChunker();
  return [...parts.flatMap((p) => c.push(p)), ...c.flush()];
}

describe('sentence chunker (Testing.md §8 chunker quality)', () => {
  it('splits on sentence punctuation as text streams in', () => {
    expect(
      chunkAll(['VS Code is open, sir. ', 'Chrome is loading now! Anything else? ', 'Done']),
    ).toEqual(['VS Code is open, sir.', 'Chrome is loading now!', 'Anything else? Done']);
  });

  it('does not split after abbreviations or decimals', () => {
    expect(
      chunkAll([
        'Use a framework, e.g. Next.js or Remix, for this project. Version 3.5 works well too.',
      ]),
    ).toEqual([
      'Use a framework, e.g. Next.js or Remix, for this project.',
      'Version 3.5 works well too.',
    ]);
  });

  it('keeps short fragments together until 20 characters', () => {
    expect(chunkAll(['Yes. No. Maybe so, sir. '])).toEqual(['Yes. No. Maybe so, sir.']);
  });

  it('cuts very long runs at a space after 200 characters', () => {
    const long = `${'word '.repeat(60)}end`;
    const out = chunkAll([long]);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]?.length).toBeLessThanOrEqual(200);
  });
});

describe('spoken extractor', () => {
  it('speaks only the <spoken> block, across arbitrary delta boundaries', () => {
    const x = new SpokenExtractor();
    const text = '<spoken>VS Code is open, sir.</spoken>\n\n| App | Status |\n|---|---|';
    let said = '';
    for (const ch of text) said += x.push(ch);
    said += x.end();
    expect(said).toBe('VS Code is open, sir.');
  });

  it('allows leading whitespace before the block', () => {
    const x = new SpokenExtractor();
    expect(x.push('  <spoken>Hello, sir.</spoken> more') + x.end()).toBe('Hello, sir.');
  });

  it('falls back to two sentences of stripped text when the block is missing', () => {
    const x = new SpokenExtractor();
    const said =
      x.push('**Done.** The [report](https://x.example) is saved. Third sentence here. ') + x.end();
    expect(said.trim()).toBe('Done. The report is saved.');
  });

  it('handles an unterminated block at the end', () => {
    const x = new SpokenExtractor();
    expect(x.push('<spoken>Cut off mid-sent') + x.end()).toBe('Cut off mid-sent');
  });

  it('short replies without tags are spoken in full at the end', () => {
    const x = new SpokenExtractor();
    expect(x.push('<sp') + x.end()).toBe('');
    const y = new SpokenExtractor();
    expect(y.push('Okay') + y.end()).toBe('Okay');
  });
});

describe('markdown stripper', () => {
  it('removes code, links, tables and formatting', () => {
    expect(
      stripMarkdown(
        '# Title\n- **Bold** item with `code`\n```js\nx()\n```\nSee [docs](https://a.b).',
      ),
    ).toBe("Title Bold item with code I've put the code on screen. See docs.");
    expect(stripMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('The details are on screen.');
    expect(stripMarkdown('Visit https://github.com/AvaanTech now')).toBe('Visit the link now');
  });

  it('escapes SSML special characters', () => {
    expect(escapeSsml(`Tom & "Jerry" <3 it's`)).toBe('Tom &amp; &quot;Jerry&quot; &lt;3 it&apos;s');
  });
});
