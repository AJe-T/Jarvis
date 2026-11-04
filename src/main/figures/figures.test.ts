import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { StagePanel } from '@shared/stage';
import type { ClaudeCodeRuntime } from '../llm/claude-code';
import {
  badArg,
  commandFor,
  FIGURE_PAGE,
  figureEnv,
  figurePermission,
  findAnatomySkill,
  pageProblem,
} from './agent';
import { createFigureJobs, createFigureTools, folderName, type FigureDeps } from './figures';

/** The sentence Sir hears when a job can't start (empty when it started). */
const errorOf = (r: { folder: string } | { error: string }): string =>
  'error' in r ? r.error : '';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'jarvis-fig-'));

describe('Anatomy skill on this PC', () => {
  it('is found where npx skills puts it for Claude Code, only with its kit', () => {
    const home = 'C:\\Users\\sir';
    const skill = join(home, '.claude', 'skills', 'anatomy');
    const files = new Set([join(skill, 'SKILL.md'), join(skill, 'kit', 'iso-kit.mjs')]);
    expect(findAnatomySkill(home, (p) => files.has(p))).toBe(skill);
    expect(findAnatomySkill(home, (p) => p === join(skill, 'SKILL.md'))).toBeNull();
    expect(findAnatomySkill(home, () => false)).toBeNull();
  });
});

describe('figure programs: fixed scripts, checked arguments', () => {
  const dirs = { work: 'C:\\fig', skill: 'C:\\skill' };

  it('runs build.mjs under Node permissions: reads the skill and folder, writes only the folder', () => {
    const cmd = commandFor('build', ['--audit'], dirs);
    expect(cmd).toEqual({
      args: [
        '--permission',
        '--allow-fs-read=C:\\skill',
        '--allow-fs-read=C:\\fig',
        '--allow-fs-write=C:\\fig',
        join('C:\\fig', 'build.mjs'),
        '--audit',
      ],
    });
    expect(commandFor('build', ['shots/x.png'], dirs)).toHaveProperty('error');
  });

  it("runs only the skill's own scripts, with paths inside the folder", () => {
    expect(commandFor('capture', [FIGURE_PAGE, '--out', 'shots/a.png'], dirs)).toEqual({
      args: [join('C:\\skill', 'scripts', 'capture.mjs'), FIGURE_PAGE, '--out', 'shots/a.png'],
    });
    for (const bad of [
      'C:\\Windows\\x.png',
      '..\\x',
      'a/../../b',
      '/etc/x',
      '~/x',
      '%TEMP%',
      'https://evil.example/',
    ]) {
      expect(badArg('capture', bad)).not.toBeNull();
    }
    expect(badArg('lines', 'shots/lines.png')).toBeNull();
  });

  it("allows only each script's documented options, and checks --option=value too", () => {
    expect(badArg('capture', '--out=shots/a.png')).toBeNull();
    expect(badArg('drive', '--actions=[["slow",0.05],["shot","a.png"]]')).toBeNull();
    for (const bad of [
      String.raw`--out=C:\Users\sir\Startup\x.cmd`,
      String.raw`--out=\\attacker\share\x`,
      String.raw`--out=sub\\attacker`,
      '--out=file:///C:/x',
      String.raw`--chrome=C:\evil.exe`,
      '--user-data-dir=prof',
      '-e',
    ])
      expect(badArg('capture', bad)).not.toBeNull();
    expect(badArg('lines', '--no-webgl')).toBeNull(); // lines passes drive's options on
  });
});

describe('figure agent permissions', () => {
  const work = tmp();
  const skill = tmp();
  const can = figurePermission(work, skill);
  const verdict = async (name: string, input: Record<string, unknown>): Promise<string> =>
    (await can(name, input, { signal: new AbortController().signal } as never))?.behavior ?? '';

  it('writes only in the figure folder and reads the skill too', async () => {
    expect(await verdict('Write', { file_path: join(work, 'build.mjs') })).toBe('allow');
    expect(await verdict('Write', { file_path: join(skill, 'SKILL.md') })).toBe('deny');
    expect(await verdict('Read', { file_path: join(skill, 'SKILL.md') })).toBe('allow');
    expect(await verdict('Read', { file_path: join(tmpdir(), 'elsewhere.txt') })).toBe('deny');
    expect(await verdict('Glob', { pattern: '../**' })).toBe('deny');
  });

  it('never gets a shell or the web; its own run tool is allowed', async () => {
    expect(await verdict('Bash', { command: 'dir' })).toBe('deny');
    expect(await verdict('WebFetch', { url: 'https://example.com' })).toBe('deny');
    expect(await verdict('mcp__figure__run', { script: 'build' })).toBe('allow');
  });
});

describe('pages and scripts are checked before anything runs', () => {
  const folder = (files: Record<string, string>): string => {
    const dir = tmp();
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };

  it('passes an offline page with SVG namespaces and a build that imports the skill by file URL', async () => {
    const dir = folder({
      'figure.html': '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>',
      'build.mjs': 'import * as k from "file:///C:/skill/kit/iso-kit.mjs";',
    });
    expect(await pageProblem(dir)).toBeNull();
  });

  it('refuses pages or scripts that reach the network or read files', async () => {
    expect(await pageProblem(folder({ 'figure.html': '<script>fetch("/x")</script>' }))).toMatch(
      /network/,
    );
    expect(
      await pageProblem(folder({ 'figure.html': '<img src="https://evil.example/p">' })),
    ).toMatch(/network/);
    expect(await pageProblem(folder({ 'a.js': 'new WebSocket(u)' }))).toMatch(/network/);
    expect(await pageProblem(folder({ 'build.mjs': 'await fetch("https://x.example")' }))).toMatch(
      /network/,
    );
    expect(await pageProblem(folder({ 'figure.html': '<iframe src="file:///C:/Users">' }))).toMatch(
      /file:/,
    );
  });
});

describe('figure environment', () => {
  it('keeps what Windows and Chrome need, never git or SSH settings', () => {
    const keys = Object.keys(figureEnv());
    expect(keys.some((k) => /^(GIT_|SSH_)/i.test(k))).toBe(false);
  });
});

describe('figure jobs (background, one at a time)', () => {
  const rt = { path: () => 'claude.exe', cwd: '', query: vi.fn() } as unknown as ClaudeCodeRuntime;

  function setup(over: Partial<FigureDeps> = {}) {
    const announced: string[] = [];
    const shown: StagePanel[] = [];
    let release: (r: { ok: boolean; summary: string }) => void = () => undefined;
    const deps: FigureDeps = {
      rt,
      dir: tmp,
      skill: () => 'C:\\skill',
      offline: () => false,
      announce: (_t, text) => announced.push(text),
      show: (p) => shown.push(p),
      node: async () => ({ exe: 'node.exe', version: 'v24.21.0' }),
      run: (input) =>
        new Promise((resolve) => {
          release = (r) => {
            if (r.ok)
              writeFileSync(join(input.dirs.work, FIGURE_PAGE), '<!doctype html><p>lock</p>');
            resolve(r);
          };
        }),
      ...over,
    };
    return {
      jobs: createFigureJobs(deps),
      announced,
      shown,
      done: (r: { ok: boolean; summary: string }) => release(r),
    };
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

  it('returns at once, then shows the figure beside the orb and says it is ready', async () => {
    const { jobs, announced, shown, done } = setup();
    const r = await jobs.start('how a cache key works', 'figure');
    expect(r).toHaveProperty('folder');
    expect(jobs.current()?.topic).toBe('how a cache key works');
    expect(errorOf(await jobs.start('something else', 'figure'))).toMatch(/still being made/);
    done({ ok: true, summary: 'A pin-tumbler lock.' });
    await settle();
    expect(shown[0]).toMatchObject({
      kind: 'artifact',
      format: 'html',
      code: '<!doctype html><p>lock</p>',
    });
    expect(announced[0]).toMatch(/ready, beside the orb\. A pin-tumbler lock\./);
    expect(jobs.current()).toBeNull();
  });

  it('says when it failed, and when it was cancelled', async () => {
    const a = setup();
    await a.jobs.start('tcp handshake', 'figure');
    a.done({ ok: false, summary: 'Stopped (max budget usd).' });
    await settle();
    expect(a.announced[0]).toMatch(/didn't finish\. Stopped/);
    expect(a.shown).toHaveLength(0);

    const b = setup();
    await b.jobs.start('tcp handshake', 'figure');
    expect(b.jobs.cancel()).toBe(true);
    b.done({ ok: false, summary: 'aborted' });
    await settle();
    expect(b.announced[0]).toMatch(/cancelled/);
  });

  it('refuses in offline mode, without the skill, Claude Code or a new enough Node', async () => {
    const refusal = async (over: Partial<FigureDeps>): Promise<string> =>
      errorOf(await setup(over).jobs.start('x y z', 'figure'));
    expect(await refusal({ offline: () => true })).toMatch(/Offline mode is on/);
    expect(await refusal({ skill: () => null })).toMatch(
      /npx skills add wheresryan22\/anatomy -g -a claude-code/,
    );
    expect(await refusal({ rt: { ...rt, path: () => null } })).toMatch(
      /Claude Code is not installed/,
    );
    expect(await refusal({ node: async () => ({ exe: 'node', version: 'v20.11.0' }) })).toMatch(
      /Node\.js 22\.13/,
    );
  });

  it('two quick requests start only one paid run', async () => {
    const { jobs } = setup();
    const [a, b] = await Promise.all([
      jobs.start('first topic', 'figure'),
      jobs.start('second topic', 'figure'),
    ]);
    expect([errorOf(a), errorOf(b)].filter((e) => /still being made/.test(e))).toHaveLength(1);
  });

  it('names each folder by time and topic', () => {
    expect(folderName('How a TCP handshake works?', new Date(2026, 10, 4, 9, 5, 7))).toBe(
      '2026-11-04 090507 how-a-tcp-handshake-works',
    );
  });
});

describe('explain_visually / figure_status tools', () => {
  it('asks Sir first and answers at once with "started"', async () => {
    const jobs = {
      start: vi.fn(async () => ({ folder: 'C:\\figs\\a' })),
      current: () => null,
      cancel: () => false,
    };
    const [explain, status] = createFigureTools(jobs);
    expect(explain?.tier).toBe('CONFIRM');
    expect(status?.tier).toBe('SAFE');
    const out = await explain!.run({ topic: 'rate limiter', size: 'figure' }, {} as never);
    expect(out.isError).toBeFalsy();
    expect(JSON.stringify(out.content)).toMatch(/Started in the background/);
    expect(JSON.stringify((await status!.run({ cancel: false }, {} as never)).content)).toMatch(
      /No figure/,
    );
  });
});
