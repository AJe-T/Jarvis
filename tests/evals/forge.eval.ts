import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createClaudeClient } from '@main/llm/claude-client';
import { idle, setupServices } from '../integration/helpers';

/**
 * Forge F7: plan quality (Testing.md §7). Does Jarvis pick the lowest Forge level that works, name
 * what to study, and write the goal completely? Real Claude; every confirmation is DECLINED, so no
 * Forge run starts and nothing on this PC changes. Run with `npm run evals` (asks first).
 */
const key = process.env['ANTHROPIC_API_KEY'];
if (!key) throw new Error('Set ANTHROPIC_API_KEY in .env to run evals.');

const t = setupServices(undefined, { llm: createClaudeClient(() => key) });
t.services.settings.set('onboarding.complete', true);
t.services.settings.set('forge.repoUrl', 'git@github.com:sir/Jarvis.git');
t.services.confirmShowListeners.add((e) => t.services.broker.respond(e.requestId, 'deny', 'click'));

interface Attempt {
  name: string;
  input: string;
}

/** A complete goal: long enough to say what it does, its inputs/outputs and an edge case. */
const COMPLETE_GOAL = /"goal":"[^"]{160,}/;
const FORGE = ['forge_start', 'forge_build_tool', 'forge_approve', 'forge_rollback'];

const CASES: Array<{
  id: string;
  input: string;
  expect: string;
  args?: RegExp[];
  forbid?: string[];
}> = [
  {
    id: 'tool-not-core',
    input:
      'Jarvis, learn to convert currencies with the free Frankfurter API (api.frankfurter.app). Name the tool currency. I have told you everything, go ahead.',
    expect: 'forge_build_tool',
    args: [/"name":"currency"/, /frankfurter/i, COMPLETE_GOAL],
    forbid: ['forge_start'],
  },
  {
    id: 'core-change',
    input:
      'Use Forge to add a dark mode toggle to your own Settings page, next to the theme picker, remembered between restarts. Everything is agreed, go ahead.',
    expect: 'forge_start',
    args: [/dark/i, COMPLETE_GOAL],
    forbid: ['forge_build_tool'],
  },
  {
    id: 'study-repo',
    input:
      'Teach yourself to make a short daily digest of RSS feeds, the way https://github.com/miniflux/v2 does it. Call the tool rss-digest. Go ahead.',
    expect: 'forge_build_tool',
    args: [/"studyApp":"https:\/\/github\.com\/miniflux\/v2/, COMPLETE_GOAL],
  },
  {
    id: 'study-app',
    input:
      'Add a command palette to your own window (Ctrl+K, fuzzy search over your pages and tools), like the one in Raycast. Go ahead with Forge.',
    expect: 'forge_start',
    args: [/"studyApp":"[^"]*raycast/i, COMPLETE_GOAL],
  },
  { id: 'status', input: 'How is Forge doing?', expect: 'forge_status', forbid: FORGE },
];

const results: Array<{ id: string; pass: boolean; why: string; tools: Attempt[] }> = [];

async function run(input: string): Promise<Attempt[]> {
  const { conversationId } = t.services.orchestrator.send({ text: input, source: 'text' });
  await idle(t.services, 120_000);
  const tools: Attempt[] = [];
  for (const m of t.services.conversations.messages(conversationId)) {
    if (m.role !== 'assistant') continue;
    const blocks = JSON.parse(m.content_json) as Array<{
      type: string;
      name?: string;
      input?: unknown;
    }>;
    for (const b of Array.isArray(blocks) ? blocks : [])
      if (b.type === 'tool_use' && b.name)
        tools.push({ name: b.name, input: JSON.stringify(b.input ?? {}) });
  }
  return tools;
}

describe('Forge plan quality (F7)', () => {
  for (const c of CASES) {
    it(c.id, async () => {
      const tools = await run(c.input);
      const fails: string[] = [];
      const picked = tools.filter((x) => x.name === c.expect);
      if (picked.length === 0) fails.push(`expected ${c.expect}`);
      for (const re of c.args ?? [])
        if (!picked.some((x) => re.test(x.input))) fails.push(`${c.expect} args !~ ${re}`);
      for (const f of c.forbid ?? [])
        if (tools.some((x) => x.name === f)) fails.push(`forbidden ${f}`);
      results.push({ id: `forge-${c.id}`, pass: fails.length === 0, why: fails.join('; '), tools });
      expect(fails).toEqual([]);
    });
  }

  it('an everyday question never reaches Forge', async () => {
    const tools = await run('What is 15 percent of 2400?');
    const used = tools.filter((x) => FORGE.includes(x.name));
    results.push({ id: 'forge-none', pass: used.length === 0, why: '', tools });
    expect(used).toEqual([]);
  });

  // Every confirmation was declined: if any Forge run started anyway, this eval is not safe.
  it('no Forge run was started', () => {
    expect(t.services.forge.history()).toEqual([]);
    expect(t.services.forge.status()).toBeNull();
  });
});

afterAll(() => {
  const out = join(
    __dirname,
    'results',
    `forge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });
  const usage = t.services.usageRepo.totals('2000-01-01', '2999-12-31');
  const passed = results.filter((r) => r.pass).length;
  writeFileSync(
    out,
    JSON.stringify({ passed, total: results.length, costUsd: usage.costUsd, results }, null, 2),
  );
  process.stdout.write(
    `\nForge evals: ${passed}/${results.length} passed, cost $${usage.costUsd.toFixed(3)}. Results: ${out}\n`,
  );
});
