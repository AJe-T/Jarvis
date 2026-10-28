/**
 * Forge safety rules (docs/Forge.md §5, Security.md §17): the files Jarvis may not change on its own,
 * and the diff checks that catch "made it green by weakening the test". Jarvis must never weaken the
 * checks that review Jarvis, so this file is itself on the list.
 */

/**
 * Relative to the repository root, forward slashes: a folder ends in "/", a name prefix ends in "*",
 * anything else is one file.
 */
export const PROTECTED_PATHS: readonly string[] = [
  // Policy engine, guards, redaction, injection scan, kill switch, audit.
  'src/main/security/',
  // Forge itself: its own rules, gates, permission checks and the repo rule it shares with settings.
  'src/main/forge/',
  'src/shared/forge.ts',
  // Where every tool call passes the policy and the confirmation dialog, and tool tiers are typed.
  'src/main/tools/executor.ts',
  'src/main/tools/confirmation-broker.ts',
  'src/main/tools/types.ts',
  // Privacy gates for the free pool and other AIs (Security.md §16.15).
  'src/main/agent/subagents.ts',
  'src/main/agent/brain-runner.ts',
  'src/main/agent/front-door.ts',
  // How Claude Code is started (no ~/.claude settings, no API key, ADR-010) and how programs run.
  'src/main/llm/claude-code.ts',
  'src/main/lib/process.ts',
  // Electron hardening: webPreferences, navigation and permission handlers, IPC validation, CSP.
  'src/main/index.ts',
  'src/main/windows/',
  'src/main/apps/browser-window.ts',
  'src/main/apps/camera-view.ts',
  'src/main/apps/terminal-window.ts',
  'src/main/ipc/handle.ts',
  'src/preload/',
  'src/renderer/index.html',
  'electron-builder.yml',
  'electron.vite.config.ts',
  // Dependencies (supply chain) and the version, which Forge sets itself when it ships.
  'package.json',
  'package-lock.json',
  '.npmrc',
  // How the checks run: test, lint, format and type settings, test setup, scripts, hooks, CI.
  'vitest.config.ts',
  'vitest.evals.config.ts',
  'playwright.config.ts',
  'eslint.config.mjs',
  '.prettierrc*',
  'tsconfig*',
  'tests/setup.ts',
  'scripts/',
  '.github/',
  '.husky/',
  '.claude/',
  '.gitignore',
  '.gitattributes',
  '.env*',
  // The rules Claude reads.
  'CLAUDE.md',
  'conversations/RULES.md',
  'docs/Security.md',
  'docs/Forge.md',
];

export type Severity = 'block' | 'warn';

export interface Finding {
  path: string;
  severity: Severity;
  problem: string;
}

/** One entry of `git diff --name-status -M -z`: A/M/D/T, or R/C with the old path in `from`. */
export interface ChangedFile {
  status: string;
  path: string;
  from?: string;
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
/**
 * Added test lines that switch tests off or narrow a run: `.skip`, `.only`, `.todo`, `.fails`,
 * `skipIf`/`runIf` (also on a line of their own, as `['skip']`), and `xit`/`xdescribe`/`xtest`.
 */
const WEAKENED_TEST =
  /(?:\.\s*|\[\s*['"`])(?:skip|only|todo|fails|skipIf|runIf)\b|\bx(?:it|describe|test)\s*\(/;
/** `it(`, `test(`, `it.each(`…, but not `regex.test(`. */
const TEST_CASE = /(?<![.\w])(?:it|test)\s*(?:\.\s*\w+\s*)?\(/g;
const ASSERTION = /\bexpect\s*\(|\bassert\s*[.(]/g;
/** Switches a whole file (or block) off for the type checker or the linter. */
const CHECK_OFF = /@ts-nocheck|eslint-disable(?!-next-line|-line)/;
/** Switches one line off: shown to Sir. */
const LINE_OFF = /@ts-ignore|@ts-expect-error|eslint-disable-(?:next-)?line/;

/** Windows paths compare case-insensitively; both separators are accepted. */
export const normalizePath = (p: string): string =>
  p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

const matches = (p: string, rule: string): boolean => {
  const r = rule.toLowerCase();
  if (r.endsWith('/')) return p.startsWith(r);
  if (r.endsWith('*')) return p.startsWith(r.slice(0, -1));
  return p === r;
};

export function isProtected(path: string, approved: readonly string[] = []): boolean {
  const p = normalizePath(path);
  if (approved.some((a) => normalizePath(a) === p)) return false;
  return PROTECTED_PATHS.some((rule) => matches(p, rule));
}

export const isTestFile = (path: string): boolean => TEST_FILE.test(path);

/**
 * Parses `git diff --name-status -M -z`: NUL-separated, so names are never quoted or escaped
 * (core.quotePath would print non-ASCII names in quotes and slip past every check).
 */
export function parseNameStatus(out: string): ChangedFile[] {
  const parts = out.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length;) {
    const status = (parts[i++] ?? '')[0];
    if (!status) continue;
    if (status === 'R' || status === 'C') {
      const from = parts[i++] ?? '';
      files.push({ status, path: parts[i++] ?? '', from });
    } else files.push({ status, path: parts[i++] ?? '' });
  }
  return files;
}

interface FileLines {
  added: string[];
  removed: string[];
}

/**
 * The added and removed lines of each file in a unified diff (`git diff` with a/ and b/ prefixes
 * and unquoted names). `---`/`+++` are headers only before a file's first hunk: inside a hunk,
 * "+++x" is the added line "++x".
 */
export function splitPatch(patch: string): Map<string, FileLines> {
  const files = new Map<string, FileLines>();
  let current: FileLines | null = null;
  let inHunk = false;
  for (const line of patch.split(/\r?\n/)) {
    const header = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (header?.[1]) {
      current = { added: [], removed: [] };
      files.set(header[1], current);
      inHunk = false;
    } else if (!current) continue;
    else if (line.startsWith('@@')) inHunk = true;
    else if (!inHunk) continue;
    else if (line.startsWith('+')) current.added.push(line.slice(1));
    else if (line.startsWith('-')) current.removed.push(line.slice(1));
  }
  return files;
}

const count = (lines: string[], re: RegExp): number =>
  lines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);

function reviewFile(path: string, f: FileLines, findings: Finding[]): void {
  const add = (severity: Severity, problem: string): void => {
    findings.push({ path, severity, problem });
  };
  if (f.added.some((l) => CHECK_OFF.test(l)))
    add('block', 'switches type checking or linting off for a whole file or block');
  else if (f.added.some((l) => LINE_OFF.test(l)))
    add('warn', 'switches type checking or linting off for a line');
  if (!isTestFile(path)) return;
  if (f.added.some((l) => WEAKENED_TEST.test(l)))
    add('block', 'a test was skipped, marked todo or failing, or narrowed with .only');
  const lostCases = count(f.removed, TEST_CASE) - count(f.added, TEST_CASE);
  if (lostCases > 0) add('block', `${lostCases} test case${lostCases === 1 ? '' : 's'} removed`);
  const lost = count(f.removed, ASSERTION) - count(f.added, ASSERTION);
  if (lost > 0) add('warn', `${lost} assertion${lost === 1 ? '' : 's'} fewer than before`);
}

/**
 * Checks a Forge diff against the rules. "block" findings stop the run; "warn" findings are shown
 * to Sir with the result. `approved` are the protected files Sir named when he started the run.
 */
export function reviewDiff(
  files: readonly ChangedFile[],
  patch: string,
  approved: readonly string[] = [],
): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    for (const p of f.from ? [f.from, f.path] : [f.path])
      if (isProtected(p, approved))
        findings.push({
          path: p,
          severity: 'block',
          problem: 'protected file changed without your approval',
        });
    if (f.status === 'D' && isTestFile(f.path))
      findings.push({ path: f.path, severity: 'block', problem: 'a test file was deleted' });
    if (f.status === 'R' && f.from && isTestFile(f.from) && !isTestFile(f.path))
      findings.push({
        path: f.from,
        severity: 'block',
        problem: `a test file was renamed to a non-test name (${f.path})`,
      });
  }
  for (const [path, lines] of splitPatch(patch)) reviewFile(path, lines, findings);
  return findings;
}
