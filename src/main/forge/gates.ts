import { reviewDiff, type ChangedFile, type Finding } from './protected';

/**
 * Forge gates (docs/Forge.md §3 step 8): nothing ships unless every check is green. Cheap checks run
 * first and the run stops at the first failure. Changed files' related tests run before the full
 * suite, because a change can break unchanged modules that import it: the full suite always runs.
 */

export const GATE_IDS = [
  'review',
  'no-copy',
  'design',
  'typecheck',
  'lint',
  'related',
  'unit',
  'evidence',
  'build',
  'e2e',
  'secrets',
] as const;
export type GateId = (typeof GATE_IDS)[number];

export interface GateResult {
  id: GateId;
  ok: boolean;
  ms: number;
  /** The end of the command's output (or the findings), for Sir and for the boss to fix. */
  tail: string;
}

export interface GateReport {
  ok: boolean;
  results: GateResult[];
  findings: Finding[];
}

/** Gates that read the diff, or that Forge runs itself (evidence), instead of one fixed command. */
type SpecialGateId = 'review' | 'no-copy' | 'design' | 'evidence';
const SPECIAL: ReadonlySet<GateId> = new Set<SpecialGateId>([
  'review',
  'no-copy',
  'design',
  'evidence',
]);
export type CommandGateId = Exclude<GateId, SpecialGateId>;

/** Node arguments for one check: an npm script (through npm-cli.js), or a script file in the repo. */
export type GateCommand = { npm: string[] } | { node: string[] };

/** Runs one command in the repo with node.exe, never a shell. */
export type GateRunner = (
  cmd: GateCommand,
  opts: { timeoutMs: number; signal: AbortSignal },
) => Promise<{ code: number | null; out: string }>;

const MIN = 60_000;
const TAIL = 3000;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/i;

/** The command and time limit of each command gate. */
export function gateCommand(
  id: CommandGateId,
  changed: readonly string[] = [],
): { cmd: GateCommand; timeoutMs: number } | null {
  switch (id) {
    case 'typecheck':
      return { cmd: { npm: ['run', 'typecheck'] }, timeoutMs: 10 * MIN };
    case 'lint':
      return { cmd: { npm: ['run', 'lint'] }, timeoutMs: 10 * MIN };
    case 'related': {
      // A file named "--config=…" would be read as a vitest option.
      const files = changed.filter((f) => SOURCE.test(f) && !f.startsWith('-'));
      if (files.length === 0) return null;
      return {
        cmd: {
          node: ['scripts/vitest-electron.mjs', 'related', '--run', '--passWithNoTests', ...files],
        },
        timeoutMs: 10 * MIN,
      };
    }
    case 'unit':
      return { cmd: { npm: ['test'] }, timeoutMs: 20 * MIN };
    case 'build':
      return { cmd: { npm: ['run', 'build'] }, timeoutMs: 10 * MIN };
    case 'e2e':
      return { cmd: { npm: ['run', 'test:e2e'] }, timeoutMs: 20 * MIN };
    case 'secrets':
      return { cmd: { npm: ['run', 'secret-scan'] }, timeoutMs: 5 * MIN };
  }
}

/** Runs one command gate; a gate with nothing to check (no changed source files) passes. */
export async function runGate(
  run: GateRunner,
  id: CommandGateId,
  changed: readonly string[],
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<GateResult> {
  const spec = gateCommand(id, changed);
  const start = now();
  if (!spec) return { id, ok: true, ms: 0, tail: 'Nothing to check.' };
  const r = await run(spec.cmd, { timeoutMs: spec.timeoutMs, signal });
  return { id, ok: r.code === 0, ms: now() - start, tail: r.out.slice(-TAIL) };
}

/** Every gate in order; stops at the first failure (or when the run is cancelled). */
export async function runGates(
  deps: { run: GateRunner; now?: () => number },
  input: {
    files: readonly ChangedFile[];
    patch: string;
    approved: readonly string[];
    signal: AbortSignal;
    onGate?: (id: GateId) => void;
    /** F6: what the no-copy check found against the studied repository (none: no study). */
    noCopy?: readonly Finding[];
    /** What the design check found in the interface lines the change adds (none: not checked). */
    design?: readonly Finding[];
    /** The proof check (evidence.ts): the change's tests against the original code (none: skipped). */
    evidence?: (signal: AbortSignal) => Promise<GateResult>;
  },
): Promise<GateReport> {
  const findings: Finding[] = [];
  const results: GateResult[] = [];
  const diffGates: Array<[GateId, readonly Finding[] | undefined, string]> = [
    ['review', reviewDiff(input.files, input.patch, input.approved), ''],
    ['no-copy', input.noCopy, 'No code copied from the studied repository.'],
    ['design', input.design, 'The interface follows the design system.'],
  ];
  for (const [id, list, clean] of diffGates) {
    if (!list) continue;
    const r = findingsGate(id, list, clean);
    findings.push(...list);
    results.push(r);
    if (!r.ok) return { ok: false, results, findings };
  }
  const changed = input.files.filter((f) => f.status !== 'D').map((f) => f.path);
  for (const id of GATE_IDS) {
    if (id === 'evidence' && !input.evidence) continue;
    if (SPECIAL.has(id) && id !== 'evidence') continue;
    if (input.signal.aborted) return { ok: false, results, findings };
    input.onGate?.(id);
    const r =
      id === 'evidence' && input.evidence
        ? await input.evidence(input.signal)
        : await runGate(deps.run, id as CommandGateId, changed, input.signal, deps.now);
    results.push(r);
    if (!r.ok) return { ok: false, results, findings };
  }
  return { ok: true, results, findings };
}

/** A gate that reads findings: it fails on any "block"; warnings only show in the report. */
function findingsGate(id: GateId, list: readonly Finding[], clean: string): GateResult {
  return {
    id,
    ok: !list.some((f) => f.severity === 'block'),
    ms: 0,
    tail:
      list.map((f) => `${f.severity.toUpperCase()} ${f.path}: ${f.problem}`).join('\n') || clean,
  };
}

export function describeReport(report: GateReport): string {
  const lines = report.results.map(
    (r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.ms ? ` (${Math.round(r.ms / 1000)} s)` : ''}`,
  );
  const failed = report.results.find((r) => !r.ok);
  const warns = report.findings.filter((f) => f.severity === 'warn');
  return [
    ...lines,
    ...(warns.length ? ['', 'Warnings:', ...warns.map((w) => `- ${w.path}: ${w.problem}`)] : []),
    ...(failed?.tail ? ['', `Output of ${failed.id}:`, failed.tail] : []),
  ].join('\n');
}
