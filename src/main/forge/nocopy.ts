import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Finding } from './protected';

/**
 * Forge phase F6, the no-copy check (docs/Forge.md §5 rule 3, Security.md §17). The lines a change
 * adds are compared with the files of the repository Forge studied: whitespace is normalised, lines
 * with little substance (`}`, `return;`, a bare import) are left out, and every run of WINDOW
 * consecutive remaining lines is hashed. A long verbatim run blocks the change; a short one is a
 * warning Sir sees before shipping.
 */

export const WINDOW = 6;
export const BLOCK_LINES = 20;
/** Many short copies add up: this many copied lines in one change block it too. */
export const BLOCK_TOTAL = 40;
const MIN_ALNUM = 8;
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT =
  /\.(?:[cm]?[jt]sx?|json|md|css|s[ac]ss|less|html?|vue|svelte|py|rs|go|java|kts?|cs|c|cc|cpp|h|hpp|m|mm|rb|php|swift|dart|lua|sh|ps1|ya?ml|toml|sql|txt)$/i;

/** One line as the check sees it, or null when it is too plain to mean anything. */
export function normalise(line: string): string | null {
  const s = line.replace(/\s+/g, ' ').trim();
  return (s.match(/[A-Za-z0-9]/g)?.length ?? 0) >= MIN_ALNUM ? s : null;
}

const meaningful = (lines: readonly string[]): string[] =>
  lines.map(normalise).filter((l): l is string => l !== null);

const hashOf = (lines: readonly string[]): string =>
  createHash('sha256').update(lines.join('\n')).digest('hex');

/** Hash of every WINDOW-line run in the studied files → the file it came from. */
export type StudyIndex = Map<string, string>;

export function addToIndex(index: StudyIndex, path: string, text: string): void {
  const lines = meaningful(text.split(/\r?\n/));
  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const h = hashOf(lines.slice(i, i + WINDOW));
    if (!index.has(h)) index.set(h, path);
  }
}

/**
 * Indexes the studied repository's text files (no .git, node_modules or links; size caps).
 * `partial`: a cap left files out, so "nothing copied" is not a full answer.
 */
export function indexStudyRepo(root: string): StudyIndex & { partial?: boolean } {
  const index: StudyIndex & { partial?: boolean } = new Map();
  let files = 0;
  let bytes = 0;
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (files >= MAX_FILES || bytes >= MAX_TOTAL_BYTES) {
        index.partial = true;
        return;
      }
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
        continue;
      }
      if (!e.isFile() || !TEXT.test(e.name)) continue;
      const size = lstatSync(p).size;
      if (size > MAX_FILE_BYTES) {
        index.partial = true;
        continue;
      }
      files++;
      bytes += size;
      addToIndex(index, relative(root, p).split('\\').join('/'), readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return index;
}

/**
 * The added lines of a unified diff, per file, as runs of consecutive added lines (a context or
 * removed line ends a run, so lines from different places never join into one window).
 */
export function addedRuns(patch: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  let file = '';
  let inHunk = false;
  let run: string[] | null = null;
  const end = (): void => {
    if (run?.length && file) out.set(file, [...(out.get(file) ?? []), run]);
    run = null;
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      end();
      [file, inHunk] = ['', false];
    } else if (!inHunk && line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : '';
    } else if (line.startsWith('@@')) {
      end();
      inHunk = true;
    } else if (inHunk && line.startsWith('+')) {
      (run ??= []).push(line.slice(1));
    } else end();
  }
  end();
  return out;
}

/** Findings for each verbatim run of WINDOW or more meaningful lines found in the studied repo. */
export function copyFindings(added: Map<string, string[][]>, index: StudyIndex): Finding[] {
  if (index.size === 0) return [];
  const findings: Finding[] = [];
  for (const [path, runs] of added)
    for (const raw of runs) {
      const lines = meaningful(raw);
      let i = 0;
      while (i + WINDOW <= lines.length) {
        const source = index.get(hashOf(lines.slice(i, i + WINDOW)));
        if (!source) {
          i++;
          continue;
        }
        // Extend while the next window also matches: one finding per copied block.
        let j = i + 1;
        while (j + WINDOW <= lines.length && index.has(hashOf(lines.slice(j, j + WINDOW)))) j++;
        const n = j - 1 - i + WINDOW;
        const block = n >= BLOCK_LINES;
        findings.push({
          path,
          severity: block ? 'block' : 'warn',
          problem: `${n} lines match ${source} in the studied repository (whitespace ignored)${block ? '; write our own version instead of copying' : ''}`,
        });
        i = j - 1 + WINDOW;
      }
    }
  const total = findings.reduce((n, f) => n + Number(/^(\d+) lines/.exec(f.problem)?.[1] ?? 0), 0);
  if (total >= BLOCK_TOTAL && !findings.some((f) => f.severity === 'block'))
    findings.push({
      path: '(whole change)',
      severity: 'block',
      problem: `${total} lines in all match the studied repository in shorter pieces; write our own version`,
    });
  return findings;
}
