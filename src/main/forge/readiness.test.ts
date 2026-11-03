import { describe, expect, it } from 'vitest';
import { canStart, FIRST_RUN_REQUEST, readiness, type ReadinessDeps } from './readiness';

const ready: ReadinessDeps = {
  repoUrl: () => 'git@github.com:sir/Jarvis.git',
  node: () => Promise.resolve({ version: 'v24.11.0' }),
  nodeRunsTools: () => true,
  nodeRunsRea: () => true,
  gitVersion: () => Promise.resolve('git version 2.51.0.windows.1'),
  claude: () => Promise.resolve({ found: true, loggedIn: true }),
  vaultReady: () => true,
  freeWorkers: () => ({ enabled: true, poolReady: true }),
  budgetUsd: () => 5,
};

describe('Forge readiness (F12)', () => {
  it('all green on a ready PC, and a run can start', async () => {
    const c = await readiness(ready);
    expect(c.map((x) => [x.id, x.state])).toEqual([
      ['repo', 'ok'],
      ['node', 'ok'],
      ['git', 'ok'],
      ['claude', 'ok'],
      ['vault', 'ok'],
      ['workers', 'ok'],
      ['budget', 'ok'],
    ]);
    expect(canStart(c)).toBe(true);
    expect(c.find((x) => x.id === 'budget')?.detail).toContain('$5');
  });

  it('each missing requirement blocks the start and says how to fix it', async () => {
    const c = await readiness({
      ...ready,
      repoUrl: () => '',
      node: () => Promise.resolve(null),
      gitVersion: () => Promise.reject(new Error('ENOENT')),
      claude: () => Promise.resolve({ found: true, loggedIn: false }),
      vaultReady: () => false,
    });
    for (const id of ['repo', 'node', 'git', 'claude', 'vault']) {
      const x = c.find((y) => y.id === id);
      expect(x?.state, id).toBe('missing');
      expect(x?.fix.length, id).toBeGreaterThan(10);
    }
    expect(canStart(c)).toBe(false);
  });

  it('a repository that is not on github.com counts as missing', async () => {
    const c = await readiness({ ...ready, repoUrl: () => 'https://evil.example/Jarvis.git' });
    expect(c[0]?.state).toBe('missing');
  });

  it('old Node and no free AIs are warnings: a change run can still start', async () => {
    const c = await readiness({
      ...ready,
      nodeRunsTools: () => false,
      freeWorkers: () => ({ enabled: true, poolReady: false }),
    });
    expect(c.find((x) => x.id === 'node')?.state).toBe('warn');
    expect(c.find((x) => x.id === 'workers')?.state).toBe('warn');
    expect(canStart(c)).toBe(true);
  });

  it('the suggested first run is a small sandboxed tool with a complete goal', () => {
    expect(FIRST_RUN_REQUEST).toMatch(/self-built tool called "currency"/);
    expect(FIRST_RUN_REQUEST).toMatch(/https:\/\/api\.frankfurter\.app/);
    expect(FIRST_RUN_REQUEST).toMatch(/tests/i);
    expect(FIRST_RUN_REQUEST.length).toBeGreaterThan(160);
  });
});
