import { describe, expect, it } from 'vitest';
import { findDuplicates, TIDY_MAX } from './tidy';

const note = (vault_path: string, title: string, facts: string[]) => ({
  vault_path,
  title,
  body: `# ${title}\n${facts.map((f) => `- ${f}`).join('\n')}\n`,
});

describe('memory tidy-up', () => {
  it('pairs a person noted twice under two names and lists what the kept note lacks', () => {
    const out = findDuplicates([
      note('Memory/People/Priya.md', 'Priya', ['Sir’s sister', 'Lives in Pune (inferred)']),
      note('Memory/People/Priya Sharma.md', 'Priya Sharma', ['Lives in Pune']),
      note('Memory/People/Rahul.md', 'Rahul', ['Colleague']),
    ]);
    expect(out).toEqual([
      { keep: 'Memory/People/Priya.md', other: 'Memory/People/Priya Sharma.md', missing: [] },
    ]);
  });

  it('pairs topic notes only when their facts mostly match, never across folders', () => {
    const work = ['Uses VS Code', 'Deploys on Vercel', 'Writes TypeScript'];
    const out = findDuplicates([
      note('Memory/Facts/Work.md', 'Work', work),
      note('Memory/Facts/Work tools.md', 'Work tools', ['Uses Figma', 'Uses Notion']),
      note('Memory/Facts/Dev setup.md', 'Dev setup', [...work, 'Uses pnpm']),
      note('Memory/Projects/Work.md', 'Work', work),
    ]);
    expect(out).toEqual([
      {
        keep: 'Memory/Facts/Dev setup.md',
        other: 'Memory/Facts/Work.md',
        missing: [],
      },
    ]);
  });

  it('ignores facts under History and caps the number of suggestions', () => {
    const many = Array.from({ length: 20 }, (_, i) => note(`Memory/People/Ann ${i}.md`, 'Ann', []));
    expect(findDuplicates(many)).toHaveLength(TIDY_MAX);
    const a = {
      vault_path: 'Memory/Facts/A.md',
      title: 'A',
      body: '- x1\n- x2\n## History\n- y\n',
    };
    const b = { vault_path: 'Memory/Facts/B.md', title: 'B', body: '- x1\n- x2\n- y\n' };
    expect(findDuplicates([a, b])[0]?.missing).toEqual([]);
  });
});
