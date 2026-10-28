import { describe, expect, it } from 'vitest';
import { describeReport, gateCommand, runGates, type GateCommand, type GateRunner } from './gates';

function fakeRunner(failOn?: string): GateRunner & { seen: string[] } {
  const seen: string[] = [];
  const run: GateRunner = (cmd: GateCommand) => {
    const label = 'npm' in cmd ? cmd.npm.join(' ') : cmd.node.join(' ');
    seen.push(label);
    const fails = failOn !== undefined && label.includes(failOn);
    return Promise.resolve({ code: fails ? 1 : 0, out: fails ? 'error TS2322: boom' : 'ok' });
  };
  return Object.assign(run, { seen });
}

const signal = new AbortController().signal;
const files = [
  { status: 'M', path: 'src/main/tools/everyday/video.ts' },
  { status: 'A', path: 'docs/notes.md' },
];

describe('Forge gates', () => {
  it('runs every check in order: cheap first, the full suite after related tests', async () => {
    const run = fakeRunner();
    const report = await runGates({ run }, { files, patch: '', approved: [], signal });
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.id)).toEqual([
      'review',
      'typecheck',
      'lint',
      'related',
      'unit',
      'build',
      'e2e',
      'secrets',
    ]);
    expect(run.seen).toEqual([
      'run typecheck',
      'run lint',
      'scripts/vitest-electron.mjs related --run --passWithNoTests src/main/tools/everyday/video.ts',
      'test',
      'run build',
      'run test:e2e',
      'run secret-scan',
    ]);
  });

  it('stops at the first failure and shows its output', async () => {
    const run = fakeRunner('lint');
    const report = await runGates({ run }, { files, patch: '', approved: [], signal });
    expect(report.ok).toBe(false);
    expect(report.results.at(-1)).toMatchObject({ id: 'lint', ok: false });
    expect(run.seen).toEqual(['run typecheck', 'run lint']);
    expect(describeReport(report)).toContain('error TS2322: boom');
  });

  it('a protected change fails before any command runs', async () => {
    const run = fakeRunner();
    const report = await runGates(
      { run },
      {
        files: [{ status: 'M', path: 'src/main/security/redact.ts' }],
        patch: '',
        approved: [],
        signal,
      },
    );
    expect(report.ok).toBe(false);
    expect(run.seen).toEqual([]);
    expect(report.results[0]?.tail).toContain('protected file');
  });

  it('a cancelled run stops between gates', async () => {
    const ctl = new AbortController();
    const run: GateRunner = () => {
      ctl.abort();
      return Promise.resolve({ code: 0, out: '' });
    };
    const report = await runGates({ run }, { files, patch: '', approved: [], signal: ctl.signal });
    expect(report.ok).toBe(false);
    expect(report.results.map((r) => r.id)).toEqual(['review', 'typecheck']);
  });

  it('related tests are skipped (passing) when no source file changed', () => {
    expect(gateCommand('related', ['docs/a.md'])).toBeNull();
    expect(gateCommand('related', ['a.tsx'])).not.toBeNull();
    // A changed file named like an option never reaches vitest's arguments.
    expect(gateCommand('related', ['--config=weak.ts'])).toBeNull();
  });
});
