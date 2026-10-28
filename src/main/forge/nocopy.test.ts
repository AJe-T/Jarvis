import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { addedRuns, copyFindings, indexStudyRepo, normalise } from './nocopy';

const ROOT = mkdtempSync(join(tmpdir(), 'forge-nocopy-'));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/** A studied file with 40 distinct, meaningful lines. */
const STUDIED = Array.from(
  { length: 40 },
  (_, i) => `  const value${i} = computeSomething(input${i}, options.limit${i});`,
);
mkdirSync(join(ROOT, 'src'), { recursive: true });
writeFileSync(join(ROOT, 'src', 'feature.js'), STUDIED.join('\n'));
mkdirSync(join(ROOT, '.git'));
writeFileSync(
  join(ROOT, '.git', 'secret.js'),
  'const ignored = "in .git, never indexed";\n'.repeat(10),
);
const index = indexStudyRepo(ROOT);

/** A diff adding `lines` to src/main/new.ts. */
const patchAdding = (lines: string[]): string =>
  [
    'diff --git a/src/main/new.ts b/src/main/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/main/new.ts',
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join('\n');

const ours = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `export const ourOwnName${i} = buildIt(${i}, 'jarvis');`);

describe('Forge no-copy check (F6)', () => {
  it('blocks a long verbatim copy of the studied code', () => {
    const f = copyFindings(
      addedRuns(patchAdding([...ours(3), ...STUDIED.slice(5, 30), ...ours(3)])),
      index,
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.path).toBe('src/main/new.ts');
    expect(f[0]?.severity).toBe('block');
    expect(f[0]?.problem).toContain('25 lines match src/feature.js');
  });

  it('still finds it when the copy is re-indented and re-spaced', () => {
    const reformatted = STUDIED.slice(0, 22).map((l) => `\t\t${l.trim().replace(/, /g, ',   ')}  `);
    const f = copyFindings(addedRuns(patchAdding(reformatted)), index);
    expect(f[0]?.severity).toBe('block');
  });

  it('warns on a short copy, and ignores five lines or fewer', () => {
    const short = copyFindings(addedRuns(patchAdding(STUDIED.slice(0, 8))), index)[0];
    expect(short?.severity).toBe('warn');
    expect(short?.problem).toContain('8 lines match');
    expect(copyFindings(addedRuns(patchAdding(STUDIED.slice(0, 5))), index)).toEqual([]);
  });

  it('many short copies add up to a block (security review 2.39)', () => {
    const pieces = [0, 1, 2, 3, 4].flatMap((k) => [
      ...STUDIED.slice(k * 8, k * 8 + 8),
      `export const ownSeparator${k} = 'between the copied pieces';`,
    ]);
    // Five 8-line pieces: each only a warning, 40 lines together.
    const patch = patchAdding(pieces);
    const f = copyFindings(addedRuns(patch), index);
    expect(f.filter((x) => x.severity === 'warn').length).toBeGreaterThan(1);
    expect(f.at(-1)).toMatchObject({ path: '(whole change)', severity: 'block' });
  });

  it('a capped index says it is partial', () => {
    const big = mkdtempSync(join(tmpdir(), 'forge-nocopy-big-'));
    writeFileSync(join(big, 'huge.js'), 'x'.repeat(1_100_000));
    expect(indexStudyRepo(big).partial).toBe(true);
    expect(index.partial).toBeUndefined();
    rmSync(big, { recursive: true, force: true });
  });

  it('plain lines (braces, returns) and our own code never count', () => {
    const plain = Array.from({ length: 30 }, (_, i) => (i % 2 ? '}' : '  return;'));
    expect(copyFindings(addedRuns(patchAdding([...plain, ...ours(30)])), index)).toEqual([]);
    expect(normalise('  });  ')).toBeNull();
  });

  it('a copy split by existing lines is not joined across them', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,9 @@',
      ...STUDIED.slice(0, 4).map((l) => `+${l}`),
      ' unchanged line in between, long enough',
      ...STUDIED.slice(4, 8).map((l) => `+${l}`),
    ].join('\n');
    expect(addedRuns(patch).get('src/a.ts')).toHaveLength(2);
    expect(copyFindings(addedRuns(patch), index)).toEqual([]);
  });

  it('never indexes .git, and an empty index finds nothing', () => {
    expect(
      copyFindings(
        addedRuns(
          patchAdding(
            Array.from({ length: 10 }, () => 'const ignored = "in .git, never indexed";'),
          ),
        ),
        index,
      ),
    ).toEqual([]);
    expect(copyFindings(addedRuns(patchAdding(STUDIED)), new Map())).toEqual([]);
  });
});
