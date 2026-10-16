// `npm run evals:compare` (idea from ruflo's guidance "evolution" pipeline): before keeping a prompt or
// policy change, compare the eval run made with it against the run before it. Free: it only reads the
// JSON files `npm run evals` wrote to tests/evals/results/. Exits 1 when anything that passed now fails.
//   npm run evals:compare                 → the two newest runs
//   npm run evals:compare -- old.json new.json
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ passed: number, total: number, costUsd?: number, results: Array<{ id: string, pass: boolean, why?: string }> }} Run */

/**
 * @param {Run} before
 * @param {Run} after
 */
export function compareRuns(before, after) {
  const was = new Map(before.results.map((r) => [r.id, r.pass]));
  const regressions = after.results.filter((r) => was.get(r.id) === true && !r.pass);
  const fixed = after.results.filter((r) => was.get(r.id) === false && r.pass);
  const added = after.results.filter((r) => !was.has(r.id));
  return {
    regressions: regressions.map((r) => ({ id: r.id, why: r.why ?? '' })),
    fixed: fixed.map((r) => r.id),
    added: added.map((r) => r.id),
    before: { passed: before.passed, total: before.total, costUsd: before.costUsd ?? 0 },
    after: { passed: after.passed, total: after.total, costUsd: after.costUsd ?? 0 },
  };
}

/** @param {ReturnType<typeof compareRuns>} c */
export function formatComparison(c) {
  const lines = [
    `Before: ${c.before.passed}/${c.before.total} passed ($${c.before.costUsd.toFixed(3)})`,
    `After:  ${c.after.passed}/${c.after.total} passed ($${c.after.costUsd.toFixed(3)})`,
  ];
  if (c.fixed.length) lines.push(`Now passing (${c.fixed.length}): ${c.fixed.join(', ')}`);
  if (c.added.length) lines.push(`New cases (${c.added.length}): ${c.added.join(', ')}`);
  if (c.regressions.length) {
    lines.push(`NOW FAILING (${c.regressions.length}) — keep the old version or fix these:`);
    for (const r of c.regressions) lines.push(`  ${r.id}: ${r.why}`);
  } else lines.push('No regressions.');
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('compare-evals.mjs')) {
  const dir = join('tests', 'evals', 'results');
  let files = process.argv.slice(2);
  if (files.length === 0) {
    const runs = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    if (runs.length < 2) {
      console.error(
        'Need two eval runs in tests/evals/results/. Run `npm run evals` before and after your change.',
      );
      process.exit(1);
    }
    files = runs.slice(-2).map((f) => join(dir, f));
  }
  const [a, b] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const c = compareRuns(a, b);
  console.log(`Comparing ${files[0]} → ${files[1]}\n`);
  console.log(formatComparison(c));
  process.exit(c.regressions.length ? 1 : 0);
}
