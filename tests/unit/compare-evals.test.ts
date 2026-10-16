import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/compare-evals.mjs');

const run = (results: Array<[string, boolean, string?]>, costUsd = 1) => ({
  passed: results.filter((r) => r[1]).length,
  total: results.length,
  costUsd,
  results: results.map(([id, pass, why]) => ({ id, pass, why: why ?? '' })),
});

/** Runs the script on two result files; returns its output and exit code. */
function compare(before: object, after: object): { out: string; code: number } {
  const dir = mkdtempSync(join(tmpdir(), 'evals-'));
  const a = join(dir, 'a.json');
  const b = join(dir, 'b.json');
  writeFileSync(a, JSON.stringify(before));
  writeFileSync(b, JSON.stringify(after));
  try {
    return { out: execFileSync(process.execPath, [SCRIPT, a, b], { encoding: 'utf8' }), code: 0 };
  } catch (err) {
    const e = err as { stdout: string; status: number };
    return { out: e.stdout, code: e.status };
  }
}

describe('evals compare (ruflo evolution-pipeline idea)', () => {
  it('lists regressions, fixes and new cases and exits 1', () => {
    const { out, code } = compare(
      run([
        ['golden-1', true],
        ['golden-2', false],
        ['injection-3', true],
      ]),
      run(
        [
          ['golden-1', false, 'expected one of open_app'],
          ['golden-2', true],
          ['injection-3', true],
          ['golden-4', true],
        ],
        1.5,
      ),
    );
    expect(code).toBe(1);
    expect(out).toContain('After:  3/4 passed ($1.500)');
    expect(out).toContain('Now passing (1): golden-2');
    expect(out).toContain('New cases (1): golden-4');
    expect(out).toContain('NOW FAILING (1)');
    expect(out).toContain('golden-1: expected one of open_app');
  });

  it('exits 0 when nothing regressed', () => {
    const r = run([['golden-1', true]]);
    const { out, code } = compare(r, r);
    expect(code).toBe(0);
    expect(out).toContain('No regressions.');
  });
});
