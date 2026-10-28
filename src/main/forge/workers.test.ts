import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  createDelegateEdit,
  parseReply,
  poolWorkers,
  rejectReason,
  type Pool,
  type WorkerDeps,
} from './workers';

const ROOT = mkdtempSync(join(tmpdir(), 'forge-workers-'));
const REPO = join(ROOT, 'repo');
mkdirSync(join(REPO, 'src'), { recursive: true });
writeFileSync(join(REPO, 'src', 'a.ts'), 'export const a = 1;\n');
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const reply = (files: Array<{ path: string; content: string }>) =>
  '```json\n' + JSON.stringify({ files, note: 'done' }) + '\n```';

function setup(
  answers: Partial<Record<Pool, Array<string | Error>>>,
  opts: { mayTrain?: boolean } = {},
) {
  const asked: string[][] = [];
  const sent: Array<{ pool: Pool; prompt: string }> = [];
  const queues = {
    'no-train': [...(answers['no-train'] ?? [])],
    'may-train': [...(answers['may-train'] ?? [])],
  };
  const deps: WorkerDeps = {
    ready: () => true,
    providers: (pool) => (pool === 'no-train' ? ['groq'] : ['gemini']),
    complete: ({ pool, prompt }) => {
      sent.push({ pool, prompt });
      const next = queues[pool].shift();
      if (next === undefined || next instanceof Error)
        return Promise.reject(next ?? new Error('free pool exhausted'));
      return Promise.resolve({ text: next, by: `${pool} model` });
    },
    askMayTrain: (providers) => {
      asked.push(providers);
      return Promise.resolve(opts.mayTrain ?? false);
    },
  };
  const stats = { free: 0, boss: 0 } as { free: number; boss: number; mayTrain?: boolean };
  const edit = createDelegateEdit({
    deps,
    repoDir: REPO,
    approved: [],
    signal: new AbortController().signal,
    stats,
  });
  return { edit, stats, asked, sent };
}

const TASK = { task: 'Change a to 2 and add b = 3', files: ['src/a.ts'] };

describe('Forge free workers (delegate_edit)', () => {
  it('a no-training free AI writes the file; Forge says it is unreviewed', async () => {
    const { edit, stats, sent, asked } = setup({
      'no-train': [
        reply([{ path: 'src/a.ts', content: 'export const a = 2;\nexport const b = 3;\n' }]),
      ],
    });
    const r = await edit(TASK);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('unreviewed');
    expect(readFileSync(join(REPO, 'src', 'a.ts'), 'utf8')).toContain('b = 3');
    expect(sent[0]?.prompt).toContain('--- FILE src/a.ts');
    expect(stats).toEqual({ free: 1, boss: 0 });
    expect(asked).toEqual([]);
  });

  it('a reply touching another file is retried once with the reason', async () => {
    const { edit, sent } = setup({
      'no-train': [
        reply([{ path: 'src/other.ts', content: 'x' }]),
        reply([{ path: 'src/a.ts', content: 'export const a = 4;\n' }]),
      ],
    });
    expect((await edit(TASK)).ok).toBe(true);
    expect(sent[1]?.prompt).toContain('src/other.ts, which was not one of the given files');
  });

  it('asks Sir once before the providers that may train; no → Claude does it', async () => {
    const { edit, stats, asked, sent } = setup({ 'no-train': [new Error('free pool exhausted')] });
    const r = await edit(TASK);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('Do this edit yourself');
    expect(asked).toEqual([['gemini']]);
    expect(sent.every((s) => s.pool === 'no-train')).toBe(true);
    expect(stats).toEqual({ free: 0, boss: 1, mayTrain: false });
    await edit(TASK);
    expect(asked).toHaveLength(1);
  });

  it('edits running at the same time share one pop-up', async () => {
    const { edit, asked } = setup({
      'no-train': [new Error('free pool exhausted'), new Error('free pool exhausted')],
    });
    await Promise.all([edit(TASK), edit(TASK)]);
    expect(asked).toHaveLength(1);
  });

  it('yes → the providers that may train are used for the rest of the run', async () => {
    const { edit, stats } = setup(
      {
        'no-train': [new Error('free pool exhausted')],
        'may-train': [reply([{ path: 'src/a.ts', content: 'export const a = 5;\n' }])],
      },
      { mayTrain: true },
    );
    const r = await edit(TASK);
    expect(r).toMatchObject({ ok: true });
    expect(r.text).toContain('may-train model');
    expect(stats.mayTrain).toBe(true);
  });

  it('never sends protected files, files outside the copy, keys, or too much', async () => {
    const { edit, sent } = setup({
      'no-train': [reply([{ path: 'src/a.ts', content: 'export const a = 6;\n' }])],
    });
    expect(
      (await edit({ task: 'Loosen the guards a bit', files: ['src/main/security/guards.ts'] })).ok,
    ).toBe(false);
    expect((await edit({ task: 'Edit a file outside', files: ['../outside.ts'] })).ok).toBe(false);
    const key = await edit({
      ...TASK,
      context: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    });
    expect(key.text).toContain('key or password');
    const big = await edit({ ...TASK, context: 'x'.repeat(3900), task: 'y'.repeat(6000) });
    expect(big.ok).toBe(true); // within the limit
    expect(sent).toHaveLength(1);
  });

  it('parses JSON wrapped in prose or fences, and explains bad replies', () => {
    expect(parseReply('Sure!\n```json\n{"files":[{"path":"a","content":"b"}]}\n```')).toEqual({
      files: [{ path: 'a', content: 'b' }],
    });
    expect(parseReply('no json here')).toBe('The reply had no JSON object.');
    expect(parseReply('{"files":[]}')).toMatch(/not in the asked shape/);
  });
});

describe('rejectReason', () => {
  const wanted = new Set(['src/a.ts']);
  it('refuses duplicates, strays and replies that cut a big file short', () => {
    const before = new Map([['src/a.ts', 'x'.repeat(5000)]]);
    expect(
      rejectReason(
        [
          { path: 'src/a.ts', content: 'a' },
          { path: 'SRC/a.ts', content: 'b' },
        ],
        wanted,
        before,
      ),
    ).toMatch(/twice/);
    expect(rejectReason([{ path: 'src/b.ts', content: 'b' }], wanted, before)).toMatch(
      /not one of/,
    );
    expect(
      rejectReason([{ path: 'src/a.ts', content: '// ...unchanged' }], wanted, before),
    ).toMatch(/removed most/);
    expect(rejectReason([{ path: 'src/a.ts', content: 'x'.repeat(4000) }], wanted, before)).toBe(
      '',
    );
  });
});

describe('poolWorkers', () => {
  const routes = [
    { provider: 'groq', tier: 2 as const, enabled: true },
    { provider: 'cerebras', tier: 2 as const, enabled: false },
    { provider: 'gemini', tier: 2 as const, enabled: true },
    { provider: 'openrouter', tier: 3 as const, enabled: true },
  ];

  it('splits tier-2 providers by their free-tier training terms; tier 3 never gets code', async () => {
    const session = vi.fn((job: { pick: (r: never[]) => unknown[] }) => ({
      trail: {
        attempts: [{ provider: 'groq', name: 'Groq', model: 'llama', tier: 2 as const, ok: true }],
      },
      ping: () => Promise.resolve(),
      stream: () =>
        Promise.resolve({
          id: 'pool_1',
          model: 'llama',
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      picked: job.pick([
        { provider: 'groq' },
        { provider: 'gemini' },
        { provider: 'nvidia' },
      ] as never[]),
    }));
    const confirm = vi.fn(() => Promise.resolve({ decision: 'approve' as const }));
    const w = poolWorkers({
      enabled: () => true,
      routes: () => routes,
      session: session as never,
      record: vi.fn(),
      confirm,
      label: (p) => p.toUpperCase(),
    });
    expect(w.providers('no-train')).toEqual(['groq']);
    expect(w.providers('may-train')).toEqual(['gemini']);
    const out = await w.complete({
      system: 's',
      prompt: 'p',
      pool: 'no-train',
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ text: 'hi', by: 'Groq · llama' });
    const job = session.mock.calls[0]?.[0] as unknown as { tiers: number[] };
    expect(job.tiers).toEqual([2]);
    const made = session.mock.results[0]?.value as { picked: unknown[] };
    expect(made.picked).toEqual([{ provider: 'groq' }]);
    expect(await w.askMayTrain(['gemini'], new AbortController().signal)).toBe(true);
    expect(JSON.stringify(confirm.mock.calls[0])).toContain('GEMINI');
  });
});
