import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '../tools/types';
import type { Forge, ForgeRun } from './forge';
import { createForgeTools } from './tools';

const ctx = {} as never;

function setup(start: Forge['start'] = vi.fn()) {
  let url = '';
  const forge: Forge = { start, status: vi.fn(() => null), cancel: vi.fn(() => false) };
  const tools = createForgeTools({
    forge,
    repoUrl: () => url,
    setRepoUrl: (u) => (url = u),
    budgetUsd: () => 5,
  });
  const byName = (n: string): Tool => tools.find((t) => t.name === n)!;
  return { forge, byName, url: () => url };
}

describe('Forge tools', () => {
  it('setup and start ask first; status and cancel do not', () => {
    const { byName } = setup();
    expect(byName('forge_setup').tier).toBe('CONFIRM');
    expect(byName('forge_start').tier).toBe('CONFIRM');
    expect(byName('forge_status').tier).toBe('SAFE');
    expect(byName('forge_cancel').tier).toBe('SAFE');
  });

  it('forge_setup accepts only a github.com repository', async () => {
    const { byName, url } = setup();
    const t = byName('forge_setup');
    expect(t.input.safeParse({ repoUrl: 'https://evil.example/x.git' }).success).toBe(false);
    expect(t.input.safeParse({ repoUrl: 'C:\\Users\\me\\Jarvis' }).success).toBe(false);
    const input = t.input.parse({ repoUrl: 'git@github.com:AJe-T/Jarvis.git' });
    await t.run(input, ctx);
    expect(url()).toBe('git@github.com:AJe-T/Jarvis.git');
  });

  it('forge_start shows protected files Sir allows and starts the run', async () => {
    const start = vi.fn(() => ({ id: 'forge_1' }) as ForgeRun);
    const { byName } = setup(start);
    const t = byName('forge_start');
    const input = t.input.parse({
      goal: 'Let the guards allow one more folder',
      allowProtected: ['src/main/security/guards.ts'],
    });
    expect(t.confirm?.(input).details).toContain('PROTECTED FILES YOU ALLOW IT TO CHANGE');
    const out = await t.run(input, ctx);
    expect(out.isError).toBeUndefined();
    expect(start).toHaveBeenCalledWith('Let the guards allow one more folder', [
      'src/main/security/guards.ts',
    ]);
  });

  it('forge_start refuses unprotected paths in allowProtected and reports start errors', async () => {
    const { byName } = setup(
      vi.fn(() => {
        throw new Error('Forge is already working on "x".');
      }),
    );
    const t = byName('forge_start');
    const bad = await t.run(
      t.input.parse({ goal: 'Some change to Jarvis here', allowProtected: ['src/a.ts'] }),
      ctx,
    );
    expect(bad.isError).toBe(true);
    const busy = await t.run(t.input.parse({ goal: 'Some change to Jarvis here' }), ctx);
    expect(JSON.stringify(busy.content)).toContain('already working');
  });

  it('forge_status says when nothing has run', async () => {
    const { byName } = setup();
    const out = await byName('forge_status').run({}, ctx);
    expect(out.content[0]).toMatchObject({ text: 'Forge has not run since Jarvis started.' });
  });
});
