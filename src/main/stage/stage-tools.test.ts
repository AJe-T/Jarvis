import { describe, expect, it } from 'vitest';
import type { StagePanel } from '@shared/stage';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPathGuard } from '../security/path-guard';
import { createStageTools, panelForFile } from './stage-tools';
import type { ToolContext } from '../tools/types';

const ctx = {} as ToolContext;

function setup(): {
  shown: Array<StagePanel | null>;
  show: ReturnType<typeof createStageTools>[0];
  hide: ReturnType<typeof createStageTools>[1];
} {
  const shown: Array<StagePanel | null> = [];
  const [show, hide] = createStageTools((p) => shown.push(p));
  if (!show || !hide) throw new Error('tools missing');
  return { shown, show, hide };
}

describe('stage panel tools', () => {
  it('shows a pomodoro with defaults filled in, and hides it', async () => {
    const { shown, show, hide } = setup();
    const input = show.input.parse({ panel: { kind: 'pomodoro' } });
    expect(typeof show.tier === 'function' ? show.tier(input) : show.tier).toBe('SAFE');
    expect(show.summarize(input)).toBe('Show pomodoro on screen');
    await show.run(input, ctx);
    await hide.run(hide.input.parse({}), ctx);
    expect(shown).toEqual([{ kind: 'pomodoro', minutes: 25, breakMinutes: 5 }, null]);
  });

  it('carries Jarvis content for generic panels and names it in the summary', () => {
    const { show } = setup();
    const input = show.input.parse({
      panel: { kind: 'list', title: 'Pending tasks', items: [{ text: 'Pay rent', done: false }] },
    });
    expect(show.summarize(input)).toBe('Show "Pending tasks" on screen');
  });

  it('shows QR and system panels without a Wi-Fi password in the summary', () => {
    const { show } = setup();
    const qr = show.input.parse({
      panel: { kind: 'qr', title: 'WIFI:S:Home;P:hunter2;;', text: 'WIFI:S:Home;P:hunter2;;' },
    });
    expect(show.summarize(qr)).not.toContain('hunter2');
    expect(show.summarize(show.input.parse({ panel: { kind: 'system' } }))).toBe(
      'Show system on screen',
    );
  });

  it('rejects unknown kinds, empty lists and oversized notes', () => {
    const { show } = setup();
    for (const panel of [
      { kind: 'webview', url: 'https://x' },
      { kind: 'list', title: 'x', items: [] },
      { kind: 'note', title: 'x', markdown: 'y'.repeat(50_001) },
      { kind: 'pomodoro', minutes: 0 },
    ])
      expect(show.input.safeParse({ panel }).success).toBe(false);
  });
});

describe('show_file (pictures, pages and documents beside the orb)', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-show-'));
  const guard = createPathGuard({ allowedRoots: () => [root], deniedPaths: () => [] });
  const shown: Array<StagePanel | null> = [];
  const tool = createStageTools((p) => shown.push(p), guard).find((t) => t.name === 'show_file');
  if (!tool) throw new Error('show_file missing');
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  it('shows a picture as an image panel, read through the path guard', async () => {
    writeFileSync(join(root, 'cat.png'), PNG);
    const r = await tool.run(tool.input.parse({ path: join(root, 'cat.png') }), ctx);
    expect(r.isError).toBeFalsy();
    expect(shown.at(-1)).toEqual({
      kind: 'image',
      title: 'cat.png',
      src: `data:image/png;base64,${PNG.toString('base64')}`,
    });
    // Contents never go back to the model.
    expect(JSON.stringify(r.content)).not.toContain(PNG.toString('base64'));
  });

  it('shows Markdown as a note, other text in a code block, and pages in the sandbox', () => {
    expect(panelForFile('C:/x/plan.md', Buffer.from('# Plan'))).toEqual({
      kind: 'note',
      title: 'plan.md',
      markdown: '# Plan',
    });
    expect(panelForFile('C:/x/a.csv', Buffer.from('a,b'))).toMatchObject({
      kind: 'note',
      markdown: '```\na,b\n```',
    });
    expect(panelForFile('C:/x/page.html', Buffer.from('<p>hi</p>'))).toEqual({
      kind: 'artifact',
      title: 'page.html',
      format: 'html',
      code: '<p>hi</p>',
    });
    expect(panelForFile('C:/x/tool.exe', Buffer.from('MZ\0\0'))).toBeNull();
    expect(panelForFile('C:/x/data.bin', Buffer.from('abc'))).toBeNull();
  });

  it('refuses files outside the allowed folders and asks before showing credentials', async () => {
    await expect(
      tool.run(tool.input.parse({ path: join(tmpdir(), 'elsewhere.png') }), ctx),
    ).rejects.toThrow();
    const tier = tool.tier as (i: { path: string }) => string;
    expect(tier({ path: join(root, '.env') })).toBe('CONFIRM');
    expect(tier({ path: join(root, 'cat.png') })).toBe('SAFE');
  });
});

describe('apps beside the orb (ADR-040)', () => {
  it('showing the camera asks sir first; the browser and terminal do not', () => {
    const { show } = setup();
    const tier = (panel: unknown): unknown =>
      typeof show.tier === 'function' ? show.tier(show.input.parse({ panel })) : show.tier;
    expect(tier({ kind: 'camera' })).toBe('CONFIRM');
    expect(tier({ kind: 'browser' })).toBe('SAFE');
    expect(tier({ kind: 'calculator', expression: '2+2' })).toBe('SAFE');
  });
});
