import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ClaudeCodeRuntime } from '../llm/claude-code';
import { fakeClaudeCode, result, text, toolUse } from '../../../tests/integration/fake-claude-code';
import { bossRules, forgePermission, insideRepo, runBoss, type CheckFn } from './boss';

// A real folder: the permission check follows junctions with realpath.
const ROOT = mkdtempSync(join(tmpdir(), 'forge-boss-'));
const REPO = join(ROOT, 'repo');
mkdirSync(join(REPO, 'src'), { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

async function decide(name: string, input: Record<string, unknown>, approved: string[] = []) {
  const r = await forgePermission(REPO, approved)(name, input, {
    signal: new AbortController().signal,
    toolUseID: 't1',
  } as never);
  return r?.behavior;
}

describe('Forge boss permissions', () => {
  it('reads anywhere in the clone, nowhere else', async () => {
    expect(await decide('Read', { file_path: join(REPO, 'src/main/a.ts') })).toBe('allow');
    expect(await decide('Grep', { pattern: 'foo' })).toBe('allow');
    expect(await decide('Read', { file_path: 'C:/Users/TEJA N/.ssh/id_ed25519' })).toBe('deny');
    expect(await decide('Glob', { pattern: '../../**/*.env' })).toBe('deny');
    expect(await decide('Glob', { pattern: 'C:/Users/**' })).toBe('deny');
    expect(await decide('Grep', { pattern: 'x', glob: '../*' })).toBe('deny');
  });

  it('writes only outside .git, node_modules and protected files', async () => {
    expect(await decide('Edit', { file_path: join(REPO, 'src/main/tools/x.ts') })).toBe('allow');
    expect(await decide('Write', { file_path: 'src/main/new.ts' })).toBe('allow');
    expect(await decide('Write', { file_path: join(REPO, '.git/hooks/pre-commit') })).toBe('deny');
    expect(await decide('Edit', { file_path: join(REPO, 'node_modules/x/index.js') })).toBe('deny');
    expect(await decide('Edit', { file_path: join(REPO, 'src/main/security/guards.ts') })).toBe(
      'deny',
    );
    expect(await decide('Write', { file_path: join(REPO, '..', 'outside.ts') })).toBe('deny');
    expect(await decide('Write', {})).toBe('deny');
  });

  it('a protected file Sir approved by name can be edited', async () => {
    const p = join(REPO, 'src/main/security/guards.ts');
    expect(await decide('Edit', { file_path: p }, ['src/main/security/guards.ts'])).toBe('allow');
  });

  it('refuses second names for files: 8.3 short names, streams, trailing dots', async () => {
    for (const p of ['src/main/SECURI~1/guards.ts', 'src/a.ts:hidden', 'src/main/security./g.ts'])
      expect(await decide('Write', { file_path: join(REPO, p) })).toBe('deny');
    expect(insideRepo(REPO, 'src/a.ts')).toBe('src/a.ts');
  });

  it('refuses ~ paths, devices, .git reads and junctions out of the clone', async () => {
    expect(await decide('Read', { file_path: '~/.ssh/id_ed25519' })).toBe('deny');
    expect(await decide('Read', { file_path: '%USERPROFILE%/x' })).toBe('deny');
    expect(await decide('Glob', { pattern: '~/**' })).toBe('deny');
    expect(await decide('Write', { file_path: join(REPO, 'src', 'nul.ts') })).toBe('deny');
    expect(await decide('Read', { file_path: join(REPO, '.git', 'config') })).toBe('deny');
    mkdirSync(join(ROOT, 'outside'));
    symlinkSync(join(ROOT, 'outside'), join(REPO, 'src', 'link'), 'junction');
    expect(await decide('Write', { file_path: join(REPO, 'src', 'link', 'x.ts') })).toBe('deny');
    expect(await decide('Read', { file_path: join(REPO, 'src', 'link', 'x.ts') })).toBe('deny');
  });

  it('has no shell or web tools', async () => {
    for (const name of ['Bash', 'PowerShell', 'WebFetch', 'NotebookEdit', 'Task'])
      expect(await decide(name, { command: 'whoami' })).toBe('deny');
    expect(await decide('mcp__forge__run_check', { check: 'lint' })).toBe('allow');
  });

  it('the rules name the approved files and tell Claude not to ship', () => {
    const rules = bossRules(['src/main/security/guards.ts'], 'PROJECT RULES');
    expect(rules).toContain('approved for this run: src/main/security/guards.ts');
    expect(rules).toContain('Do not bump the version');
    expect(rules).toContain('PROJECT RULES');
  });
});

describe('runBoss', () => {
  const rtWith = (query: ReturnType<typeof fakeClaudeCode>): ClaudeCodeRuntime => ({
    path: () => 'C:/fake/claude.exe',
    cwd: 'C:/fake/cwd',
    query: async () => query,
  });

  it('runs Claude Code in the clone with file tools, the budget and Forge checks', async () => {
    const checks: string[] = [];
    const check: CheckFn = (c, files) => {
      checks.push(`${c}:${files.join(',')}`);
      return Promise.resolve({
        id: c === 'test' ? 'related' : c,
        ok: false,
        ms: 1000,
        tail: 'TS2322',
      });
    };
    let checkReply = '';
    const query = fakeClaudeCode(async function* (io) {
      yield toolUse('m1', 'u1', 'Edit', { file_path: join(REPO, 'src/a.ts') });
      const r = await io.callTool('run_check', { check: 'test', files: ['src/a.ts'] }, 'u2');
      checkReply = r.content[0]?.text ?? '';
      yield text('m2', 'Done: added a.');
      yield result('success', {
        result: 'Before/After/Why: added a.',
        total_cost_usd: 0.42,
        num_turns: 7,
      });
    });
    const progress: string[] = [];
    const r = await runBoss({
      rt: rtWith(query),
      repoDir: REPO,
      brief: 'Add a',
      rules: 'RULES',
      approved: [],
      budgetUsd: 3,
      signal: new AbortController().signal,
      check,
      changedFiles: () => Promise.resolve(' M src/a.ts'),
      onProgress: (t) => progress.push(t),
    });
    const opts = query.calls[0];
    expect(opts?.cwd).toBe(REPO);
    expect(opts?.tools).toEqual(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite']);
    expect(opts?.disallowedTools).toContain('Bash');
    expect(opts?.permissionMode).toBe('default');
    expect(Object.keys(opts?.env ?? {})).not.toContain('ANTHROPIC_API_KEY');
    expect(opts?.maxBudgetUsd).toBe(3);
    expect(opts?.settingSources).toEqual([]);
    expect(opts?.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'RULES' });
    expect(checks).toEqual(['test:src/a.ts']);
    expect(checkReply).toContain('FAIL related');
    expect(checkReply).toContain('TS2322');
    expect(progress[0]).toContain('Editing');
    expect(r).toEqual({ ok: true, summary: 'Before/After/Why: added a.', costUsd: 0.42, turns: 7 });
  });

  it('offers delegate_edit only when free workers are on, and passes its answer back', async () => {
    let tools: string[] = [];
    let answer = '';
    const query = fakeClaudeCode(async function* (io) {
      tools = await io.listTools();
      const r = await io.callTool('delegate_edit', { task: 'x', files: ['src/a.ts'] }, 'u1');
      answer = r.content[0]?.text ?? '';
      yield result('success', { result: 'ok', total_cost_usd: 0, num_turns: 1 });
    });
    await runBoss({
      rt: rtWith(query),
      repoDir: REPO,
      brief: 'Add a',
      rules: '',
      approved: [],
      budgetUsd: 3,
      signal: new AbortController().signal,
      check: () => Promise.reject(new Error('unused')),
      changedFiles: () => Promise.resolve(''),
      delegate: (raw) => Promise.resolve({ ok: true, text: `wrote ${JSON.stringify(raw)}` }),
      onProgress: () => undefined,
    });
    expect(tools).toEqual(['delegate_edit', 'run_check', 'changed_files']);
    expect(answer).toContain('src/a.ts');
    expect(bossRules([], '', true)).toContain('try delegate_edit first');
    expect(bossRules([], '', false)).not.toContain('delegate_edit');
  });

  it('reports why it stopped when the budget or turn limit ends the run', async () => {
    const query = fakeClaudeCode(async function* () {
      yield text('m1', 'Half done.');
      yield result('error_max_turns', { total_cost_usd: 2, num_turns: 300 });
    });
    const r = await runBoss({
      rt: rtWith(query),
      repoDir: REPO,
      brief: 'Add a',
      rules: '',
      approved: [],
      budgetUsd: 3,
      signal: new AbortController().signal,
      check: () => Promise.reject(new Error('unused')),
      changedFiles: () => Promise.resolve(''),
      onProgress: () => undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('turn limit');
    expect(r.summary).toContain('Half done.');
  });
});
