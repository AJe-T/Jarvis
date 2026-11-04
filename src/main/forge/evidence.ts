import type { GateResult } from './gates';
import { isTestFile, type ChangedFile } from './protected';

/**
 * Forge playbooks and the proof check (idea from michael-denyer/pstack-claude's playbooks and
 * "failing, then passing" evidence; code is ours). The goal picks a playbook, the playbook adds a
 * few rules to the boss's brief, and for fixes and features the evidence gate proves the change's
 * tests catch it: the run's new or changed unit tests must FAIL against the original code. The
 * unit gate before it already showed they pass with the change.
 */

export type Playbook = 'fix' | 'feature' | 'refactor';

const FIX =
  /\b(?:fix(?:es|ed)?|bugs?|broken|breaks?|crash(?:es|ing)?|errors?|fails?|failing|regression|doesn'?t work|not working|wrong)\b/i;
const REFACTOR = /\b(?:refactor|clean ?up|tidy|rename|simplif(?:y|ies)|restructure|dedupe)\b/i;

/** The goal's playbook: a bug report is a fix, a tidy-up a refactor, anything else a feature. */
export function playbookFor(goal: string): Playbook {
  if (FIX.test(goal)) return 'fix';
  if (REFACTOR.test(goal)) return 'refactor';
  return 'feature';
}

const RULES: Record<Playbook, string> = {
  fix: `
# Playbook: fix
1. Reproduce first: write a unit test (*.test.ts) that shows the bug, and run_check it to see it FAIL for the reported reason.
2. Find the root cause (read every caller of the function you change) and fix it there, once.
3. Run the test again and see it pass, then the related tests.
Forge proves this: your new or changed unit tests must fail against the original code and pass with yours.`,
  feature: `
# Playbook: feature
1. Write the unit tests (*.test.ts) for the new behaviour first; they cannot pass before the code exists.
2. Build the smallest version that makes them pass, reusing what the codebase already has.
Forge proves this: your new or changed unit tests must fail against the original code and pass with yours. A change to the interface only (renderer .tsx/.css) is checked by the design check instead.`,
  refactor: `
# Playbook: refactor
Behaviour must not change: keep every existing test as it is (renaming a test file along with its module is fine) and let the full suite prove it. Add tests only for code that had none.`,
};

export function playbookRules(p: Playbook): string {
  return RULES[p];
}

const UNIT_TEST = /\.test\.[cm]?[jt]sx?$/i;
const CODE = /\.(?:[cm]?[jt]sx?)$/i;
const UI_ONLY = /^src\/renderer\/.*\.(?:tsx|css)$/i;

/** What the proof check reverts and runs, or why the run needs none. */
export type EvidencePlan =
  | { skip: string }
  | { missing: string }
  | {
      tests: string[];
      /** Changed or deleted code files: back to their original version. */
      restore: string[];
      /** Code files the change added: removed while the tests run. */
      remove: string[];
    };

export function evidencePlan(playbook: Playbook, files: readonly ChangedFile[]): EvidencePlan {
  if (playbook === 'refactor') return { skip: 'a refactor: the full suite is the proof' };
  const code = files.filter((f) => CODE.test(f.path) && !isTestFile(f.path));
  if (code.length === 0) return { skip: 'no code changed' };
  if (code.every((f) => UI_ONLY.test(f.path)))
    return { skip: 'interface only: the design check covers it' };
  // A file named "--config=…" would be read as a vitest option.
  const tests = files
    .filter((f) => f.status !== 'D' && UNIT_TEST.test(f.path) && !f.path.startsWith('-'))
    .map((f) => f.path);
  if (tests.length === 0)
    return {
      missing: `The ${playbook} changed code but no unit test (*.test.ts): nothing shows the change is needed or works.`,
    };
  const restore: string[] = [];
  const remove: string[] = [];
  for (const f of code) {
    if (f.status === 'A' || f.status === 'C') remove.push(f.path);
    else if (f.status === 'R' && f.from) {
      remove.push(f.path);
      restore.push(f.from);
    } else restore.push(f.path);
  }
  return { tests, restore, remove };
}

/** The vitest command for the tests, on Electron's Node like every other test gate. */
export function redCommand(tests: readonly string[]): { node: string[] } {
  // No --passWithNoTests: "no test files found" must exit non-zero (and redResult rejects it).
  return { node: ['scripts/vitest-electron.mjs', 'run', ...tests] };
}

const TAIL = 3000;

/**
 * Turns the run against the original code into the gate result. Proof means a test FAILED there;
 * a crash before any test ran (no files found, the runner itself broke) proves nothing.
 */
export function redResult(r: { code: number | null; out: string }, ms: number): GateResult {
  const tail = r.out.slice(-TAIL);
  const testFailed = r.code !== 0 && /\bfailed\b|\bFAIL\b/.test(r.out);
  if (testFailed)
    return {
      id: 'evidence',
      ok: true,
      ms,
      tail: `The change's tests fail against the original code, so they catch it:\n${tail}`,
    };
  return {
    id: 'evidence',
    ok: false,
    ms,
    tail:
      r.code === 0
        ? `The change's tests already pass against the original code, so they don't prove the change. Make them test what changed.\n${tail}`
        : `The tests could not run against the original code:\n${tail}`,
  };
}
