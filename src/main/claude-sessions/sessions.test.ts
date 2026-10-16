import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPathGuard } from '../security/path-guard';
import type { ToolContext } from '../tools/types';
import {
  announcement,
  createSessionReader,
  createSessionWatcher,
  readTail,
  REANNOUNCE_MS,
  stateOf,
  WAIT_MS,
  type SessionSource,
  type SessionState,
} from './sessions';
import { nodeRunsRea } from './rea';
import { createClaudeSessionTools, quoteWindowsArg, worktreeName } from './tools';

describe('nodeRunsRea', () => {
  it('follows REA engines: 22.19+, 24.11+, 26+', () => {
    const versions = ['v22.15.0', 'v22.19.0', 'v23.9.0', 'v24.10.1', 'v24.11.0', 'v26.0.0'];
    expect(versions.map(nodeRunsRea)).toEqual([false, true, false, false, true, true]);
  });
});
import { spawnSync } from 'node:child_process';

const NOW = 1_000_000_000;
const toolUse = (name: string) => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Running it' },
      { type: 'tool_use', name },
    ],
  },
});
const reply = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
};
const ask = { type: 'user', message: { role: 'user', content: 'Fix the tests' } };

function source(
  sessions: Array<{
    id: string;
    ageMs: number;
    cwd: string;
    msgs: Array<{ type: string; message: unknown }>;
  }>,
) {
  const messages = vi.fn(async (id: string) => sessions.find((s) => s.id === id)?.msgs ?? []);
  const src: SessionSource = {
    list: async () =>
      sessions.map((s) => ({
        sessionId: s.id,
        summary: `About ${s.id}`,
        lastModified: NOW - s.ageMs,
        cwd: s.cwd,
      })),
    messages,
  };
  return { src, messages };
}

describe('Claude Code sessions', () => {
  it('reads the end of a transcript', () => {
    expect(readTail([ask, toolUse('Bash')])).toEqual({ kind: 'tool-pending', tool: 'Bash' });
    expect(readTail([ask, reply, { type: 'system', message: {} }])).toEqual({ kind: 'replied' });
    expect(readTail([reply, ask])).toEqual({ kind: 'user' });
    expect(readTail([])).toBeNull();
  });

  it('a tool call left unanswered for 20 s means the session waits on Sir', () => {
    const tail = { kind: 'tool-pending' as const, tool: 'Bash' };
    expect(stateOf(tail, WAIT_MS - 1)).toBe('working');
    expect(stateOf(tail, WAIT_MS)).toBe('needs-you');
    expect(stateOf({ kind: 'replied' }, 60_000)).toBe('finished');
    expect(stateOf({ kind: 'replied' }, 60 * 60_000)).toBe('idle');
    expect(stateOf({ kind: 'user' }, 5 * 60_000)).toBe('idle');
  });

  it('lists recent sessions, skips day-old ones and re-reads only changed transcripts', async () => {
    const { src, messages } = source([
      { id: 'a', ageMs: 60_000, cwd: 'C:\\code\\Jarvis', msgs: [ask, toolUse('Edit')] },
      { id: 'b', ageMs: 5_000, cwd: 'C:\\code\\site', msgs: [ask] },
      { id: 'old', ageMs: 2 * 24 * 3600_000, cwd: 'C:\\code\\old', msgs: [ask] },
    ]);
    const reader = createSessionReader(src, () => NOW);
    const list = await reader.list();
    expect(list.map((s) => [s.project, s.state, s.waitingFor])).toEqual([
      ['site', 'working', undefined],
      ['Jarvis', 'needs-you', 'Edit'],
    ]);
    await reader.list();
    expect(messages).toHaveBeenCalledTimes(2);
  });

  it('announces newly blocked sessions, and finished ones only when asked for everything', () => {
    const before = new Map([
      ['a', 'working' as const],
      ['b', 'working' as const],
    ]);
    const now = [
      {
        id: 'a',
        project: 'Jarvis',
        cwd: '',
        title: '',
        state: 'needs-you' as const,
        lastModified: 0,
        waitingFor: 'Bash',
      },
      { id: 'b', project: 'site', cwd: '', title: '', state: 'finished' as const, lastModified: 0 },
    ];
    expect(announcement(before, now, 'waiting')).toBe(
      'Sir, Claude Code in Jarvis is waiting on you; it wants to use Bash.',
    );
    expect(announcement(before, now, 'all')).toMatch(/Claude Code finished in site\.$/);
    expect(announcement(new Map([['a', 'needs-you']]), now.slice(0, 1), 'all')).toBeNull();
  });

  it('the watcher stays silent on its first poll and speaks on the next change', async () => {
    const sessions = [
      { id: 'a', ageMs: 5_000, cwd: 'C:\\code\\Jarvis', msgs: [ask, toolUse('Bash')] },
    ];
    let t = NOW;
    const reader = createSessionReader(source(sessions).src, () => t);
    const announce = vi.fn();
    const w = createSessionWatcher({ reader, level: () => 'waiting', announce, onError: vi.fn() });
    await w.poll();
    expect(announce).not.toHaveBeenCalled();
    t = NOW + WAIT_MS;
    await w.poll();
    expect(announce).toHaveBeenCalledWith(
      'Sir, Claude Code in Jarvis is waiting on you; it wants to use Bash.',
    );
  });

  it('a session flipping between working and waiting is announced once per cooldown', async () => {
    let state: SessionState = 'working';
    let t = NOW;
    const reader = {
      list: async () => [
        { id: 'a', project: 'Jarvis', cwd: '', title: '', state, lastModified: t },
      ],
    };
    const announce = vi.fn();
    const w = createSessionWatcher({
      reader,
      level: () => 'waiting',
      announce,
      onError: vi.fn(),
      now: () => t,
    });
    await w.poll(); // learns
    for (const next of ['needs-you', 'working', 'needs-you', 'working', 'needs-you'] as const) {
      state = next;
      t += 60_000;
      await w.poll();
    }
    expect(announce).toHaveBeenCalledTimes(1);
    t += REANNOUNCE_MS;
    state = 'working';
    await w.poll();
    state = 'needs-you';
    await w.poll();
    expect(announce).toHaveBeenCalledTimes(2);
  });
});

describe('Claude Code tools', () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'jarvis-cc-')));
  const ctx = {} as ToolContext;
  const make = (
    launch = vi.fn(),
    path: string | null = 'C:\\claude.exe',
    node: string | null = 'v24.11.0',
  ) => {
    const { src } = source([
      { id: 'a', ageMs: 60_000, cwd: 'C:\\code\\Jarvis', msgs: [ask, toolUse('Bash')] },
    ]);
    const tools = createClaudeSessionTools({
      reader: createSessionReader(src, () => NOW),
      planLimits: () => null,
      claudePath: () => path,
      guard: createPathGuard({ allowedRoots: () => [root], deniedPaths: () => [] }),
      now: () => NOW,
      launch,
      reaConfigDir: join(root, '.rea'),
      nodeVersion: async () => node,
    });
    return { launch, tool: (n: string) => tools.find((t) => t.name === n)! };
  };

  it('claude_sessions reports who is waiting', async () => {
    const out = await make().tool('claude_sessions').run({ onlyWaiting: true }, ctx);
    const first = out.content[0];
    expect(first?.type === 'text' ? first.text : '').toContain(
      'Jarvis: WAITING ON YOU (wants to use Bash)',
    );
  });

  it('start_claude_session is CONFIRM, refuses flag-like briefs and launches claude in the folder', async () => {
    const { tool, launch } = make();
    const t = tool('start_claude_session');
    expect(t.tier).toBe('CONFIRM');
    expect(
      t.input.safeParse({ folder: root, brief: '--dangerously-skip-permissions now' }).success,
    ).toBe(false);
    const out = await t.run(
      { folder: root, brief: 'Add a dark mode toggle, plan first, then TDD.' },
      ctx,
    );
    expect(out.isError).toBeUndefined();
    expect(launch).toHaveBeenCalledWith(
      'C:\\claude.exe',
      ['Add a dark mode toggle, plan first, then TDD.'],
      root,
    );
  });

  it('start_claude_session isolates a session in its own worktree, only in a git repo', async () => {
    const { tool, launch } = make();
    const t = tool('start_claude_session');
    const brief = 'Fix the flaky login test, plan first.';
    const refused = await t.run({ folder: root, brief, isolate: true }, ctx);
    expect(refused.isError).toBe(true);
    expect(launch).not.toHaveBeenCalled();

    mkdirSync(join(root, '.git'), { recursive: true });
    const out = await t.run({ folder: root, brief, isolate: true, studyApp: 'Raycast' }, ctx);
    expect(out.isError).toBeUndefined();
    const [, args] = launch.mock.calls[0] as [string, string[], string];
    // --mcp-config must stay last: it swallows every value after it.
    expect(args[1]).toBe('--worktree');
    // Seconds plus a random suffix: two sessions started in the same minute never share one.
    expect(args[2]).toMatch(/^jarvis-\d{14}-[0-9a-f]{4}$/);
    expect(args[3]).toBe('--mcp-config');
    expect(worktreeName(Date.UTC(2026, 9, 14, 18, 5, 9), 'ab12')).toBe(
      'jarvis-20261014180509-ab12',
    );
  });

  it('start_claude_session attaches REA for that session when asked to study an app', async () => {
    const { tool, launch } = make();
    const out = await tool('start_claude_session').run(
      { folder: root, brief: 'Add a command palette like Raycast has.', studyApp: 'Raycast' },
      ctx,
    );
    expect(out.isError).toBeUndefined();
    const [, args] = launch.mock.calls[0] as [string, string[], string];
    expect(args[0]).toMatch(/^First study how Raycast does this, using the REA tools/);
    expect(args[0]).toContain('Add a command palette like Raycast has.');
    expect(args[1]).toBe('--mcp-config');
    const config = JSON.parse(readFileSync(args[2] ?? '', 'utf8')) as {
      mcpServers: { rea: { args: string[] } };
    };
    expect(config.mcpServers.rea.args).toEqual(['-y', 'rea-agents@6.4.0', 'mcp']);
  });

  it('start_claude_session explains when Node is too old for REA', async () => {
    const launch = vi.fn();
    const out = await make(launch, 'C:\\claude.exe', 'v22.15.0')
      .tool('start_claude_session')
      .run({ folder: root, brief: 'Build the thing please', studyApp: 'Notion' }, ctx);
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.content)).toContain('you have v22.15.0');
    expect(launch).not.toHaveBeenCalled();
  });

  it('start_claude_session reports a launch failure instead of claiming success', async () => {
    const launch = vi.fn(() => Promise.reject(new Error('ENOENT')));
    const out = await make(launch)
      .tool('start_claude_session')
      .run({ folder: root, brief: 'Build the thing please' }, ctx);
    expect(out.isError).toBe(true);
  });

  it('start_claude_session fails clearly without Claude Code or outside allowed folders', async () => {
    const missing = await make(vi.fn(), null)
      .tool('start_claude_session')
      .run({ folder: root, brief: 'Build the thing please' }, ctx);
    expect(missing.isError).toBe(true);
    await expect(
      make()
        .tool('start_claude_session')
        .run({ folder: 'C:\\Windows', brief: 'Build the thing please' }, ctx),
    ).rejects.toThrow();
  });
});

describe('quoteWindowsArg', () => {
  it('survives a real Windows command-line round trip unchanged', () => {
    const tricky = 'Fix "auth" in C:\\code\\ & | ; %PATH% $(x) ^ trailing\\';
    const { stdout: out } = spawnSync(
      process.execPath,
      [
        '-e',
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        quoteWindowsArg(tricky),
      ],
      {
        windowsVerbatimArguments: true,
        // Verbatim means nothing is quoted, the program path included.
        argv0: `"${process.execPath}"`,
        encoding: 'utf8',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    );
    expect(JSON.parse(String(out))).toEqual([tricky]);
  });
});
