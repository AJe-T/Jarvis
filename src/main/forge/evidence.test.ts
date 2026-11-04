import { describe, expect, it } from 'vitest';
import { evidencePlan, playbookFor, redCommand, redResult } from './evidence';

describe('Forge playbooks', () => {
  it.each([
    ['Fix the timer crash on resume', 'fix'],
    ["The volume slider doesn't work", 'fix'],
    ['Refactor the weather module', 'refactor'],
    ['Clean up the settings page code', 'refactor'],
    ['Add a weather tool', 'feature'],
  ])('%s → %s', (goal, want) => {
    expect(playbookFor(goal)).toBe(want);
  });
});

describe('Forge proof plan', () => {
  it('reverts changed code, removes added code, keeps the tests', () => {
    expect(
      evidencePlan('fix', [
        { status: 'M', path: 'src/main/a.ts' },
        { status: 'A', path: 'src/main/b.ts' },
        { status: 'R', from: 'src/main/old.ts', path: 'src/main/new.ts' },
        { status: 'D', path: 'src/main/gone.ts' },
        { status: 'A', path: 'src/main/a.test.ts' },
        { status: 'M', path: 'docs/BIBLE.md' },
      ]),
    ).toEqual({
      tests: ['src/main/a.test.ts'],
      restore: ['src/main/a.ts', 'src/main/old.ts', 'src/main/gone.ts'],
      remove: ['src/main/b.ts', 'src/main/new.ts'],
    });
  });

  it('needs a unit test when a fix or feature changes code (e2e specs do not count)', () => {
    expect(
      evidencePlan('feature', [
        { status: 'M', path: 'src/main/a.ts' },
        { status: 'A', path: 'tests/e2e/a.spec.ts' },
      ]),
    ).toHaveProperty('missing');
  });

  it('skips refactors, docs-only and interface-only changes', () => {
    const code = [{ status: 'M', path: 'src/main/a.ts' }];
    expect(evidencePlan('refactor', code)).toHaveProperty('skip');
    expect(evidencePlan('fix', [{ status: 'M', path: 'docs/BIBLE.md' }])).toHaveProperty('skip');
    expect(
      evidencePlan('feature', [
        { status: 'M', path: 'src/renderer/src/features/x/x.tsx' },
        { status: 'M', path: 'src/renderer/src/features/x/x.css' },
      ]),
    ).toHaveProperty('skip');
  });

  it('never passes a file that looks like an option to vitest', () => {
    const plan = evidencePlan('fix', [
      { status: 'M', path: 'src/main/a.ts' },
      { status: 'A', path: '--config=evil.test.ts' },
    ]);
    expect(plan).toHaveProperty('missing');
    expect(redCommand(['src/main/a.test.ts']).node).toEqual([
      'scripts/vitest-electron.mjs',
      'run',
      'src/main/a.test.ts',
    ]);
  });
});

describe('Forge proof result', () => {
  it('a failing test against the original code is the proof', () => {
    expect(redResult({ code: 1, out: 'FAIL a.test.ts\n Tests 1 failed' }, 5).ok).toBe(true);
  });

  it('tests that pass against the original code prove nothing', () => {
    const r = redResult({ code: 0, out: 'Tests 3 passed' }, 5);
    expect(r.ok).toBe(false);
    expect(r.tail).toContain('already pass');
  });

  it('a runner crash (no test ran) is not proof', () => {
    expect(redResult({ code: 1, out: 'No test files found, exiting with code 1' }, 5).ok).toBe(
      false,
    );
  });
});
