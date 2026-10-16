import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ToolError } from '../../errors';
import { defineTool, fail, ok, type Tool } from '../types';

/**
 * create_video (idea from heygen-com/hyperframes, Apache-2.0): Jarvis writes an HTML composition and
 * HyperFrames renders it to a video on this PC (headless Chrome + FFmpeg). Nothing of HyperFrames is
 * bundled: Sir's own Node runs the pinned version through npx, as with REA (ADR-031). Its anonymous
 * telemetry is switched off. Always asks first: it runs a program, may download it, and uses the CPU.
 */

export const HYPERFRAMES_PACKAGE = 'hyperframes@0.8.157';
/** Rendering a minute of 1080p can take several minutes on a laptop. */
const RENDER_TIMEOUT_MS = 20 * 60_000;
const MAX_LOG = 4000;
/** How much of the composition the confirmation shows. */
const PREVIEW_CHARS = 1500;
const FORMATS = ['mp4', 'gif', 'webm'] as const;
/** Where a composition may load scripts and fonts from (GSAP, Lottie, Google Fonts); nothing else. */
export const ALLOWED_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  // SVG namespace names (xmlns="http://www.w3.org/2000/svg"): identifiers, never fetched.
  'www.w3.org',
]);
/** What the render's processes may see of Jarvis's environment (never keys or tokens). */
const ENV_KEEP = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
];

/** HyperFrames needs Node 22 or later. */
export function nodeRunsHyperFrames(version: string): boolean {
  const m = /^v?(\d+)\./.exec(version.trim());
  return !!m && Number(m[1]) >= 22;
}

/** File-name-safe title: letters, digits, spaces and dashes, at most 60 characters; never CON, NUL… */
export function videoSlug(title: string): string {
  const slug =
    title
      .replace(/[^\p{L}\p{N} -]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Video';
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(slug) ? `Video ${slug}` : slug;
}

/**
 * The checks a composition needs before spending minutes on a render, and the safety ones: it may
 * not read files on this PC or reach any site except the script/font CDNs above (Claude may have
 * written it after reading a web page).
 */
export function checkComposition(html: string): string | null {
  if (!/data-composition-id\s*=\s*["']([\w-]+)["']/.test(html))
    return 'The root element needs data-composition-id (for example data-composition-id="main").';
  if (!/data-width\s*=/.test(html) || !/data-height\s*=/.test(html))
    return 'The root element needs data-width and data-height (for example 1920 and 1080).';
  if (/<template[^>]*>\s*<div[^>]*data-composition-id/i.test(html))
    return 'A standalone composition must not be wrapped in <template>.';
  if (/file:/i.test(html)) return 'The composition may not use file: addresses.';
  if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b/.test(html))
    return 'The composition may not make network requests (fetch, XMLHttpRequest, WebSocket…).';
  for (const m of html.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = (m[1] ?? '').toLowerCase();
    if (!ALLOWED_HOSTS.has(host))
      return `The composition may only load from ${[...ALLOWED_HOSTS].join(', ')} (found ${host}). Inline images as data: URLs.`;
  }
  return null;
}

/** Kills a process and everything it started (npx → node → Chrome, FFmpeg). */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
}

function run(
  file: string,
  args: string[],
  opts: { cwd: string; signal: AbortSignal; timeoutMs: number; env: NodeJS.ProcessEnv },
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, windowsHide: true });
    let out = '';
    const keep = (d: Buffer): void => {
      out = (out + d.toString('utf8')).slice(-MAX_LOG * 4);
    };
    const stop = (): void => killTree(child.pid);
    const timer = setTimeout(stop, opts.timeoutMs);
    opts.signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', stop);
      resolve({ code, out });
    });
  });
}

/** `[path to node.exe, version]` of the Node on PATH, or null. */
function systemNode(): Promise<{ exe: string; version: string } | null> {
  return new Promise((resolve) => {
    execFile(
      'node',
      ['-p', 'process.execPath + "|" + process.version'],
      { windowsHide: true, timeout: 5_000 },
      (err, stdout) => {
        const [exe, version] = stdout.trim().split('|');
        resolve(err || !exe || !version ? null : { exe, version });
      },
    );
  });
}

function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { windowsHide: true, timeout: 10_000 }, (err) =>
      resolve(!err),
    );
  });
}

export interface VideoDeps {
  /** Folder renders go to (Videos\Jarvis). */
  videosDir(): string;
  /** Tests: stand-ins for the environment checks and the render itself. */
  env?: {
    node(): Promise<{ exe: string; version: string } | null>;
    ffmpeg(): Promise<boolean>;
    render(
      args: string[],
      cwd: string,
      signal: AbortSignal,
    ): Promise<{ code: number | null; out: string }>;
  };
}

function renderEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  for (const k of ENV_KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

/**
 * npx.cmd can't be spawned without a shell on current Node, so run npm's own npx script with the
 * same node.exe (no shell, an argument array).
 */
function npxRender(nodeExe: string) {
  return (args: string[], cwd: string, signal: AbortSignal) => {
    const npx = join(dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (!existsSync(npx)) throw new ToolError(`npm's npx was not found next to ${nodeExe}.`);
    return run(nodeExe, [npx, '-y', HYPERFRAMES_PACKAGE, ...args], {
      cwd,
      signal,
      timeoutMs: RENDER_TIMEOUT_MS,
      env: renderEnv(),
    });
  };
}

/** Local time to the second, so two renders of one title never share a folder. */
function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function createVideoTools(deps: VideoDeps): Tool[] {
  const env = deps.env ?? {
    node: systemNode,
    ffmpeg: hasFfmpeg,
    render: async (args: string[], cwd: string, signal: AbortSignal) => {
      const node = await systemNode();
      if (!node) throw new ToolError('Node.js is not installed.');
      return npxRender(node.exe)(args, cwd, signal);
    },
  };
  return [
    defineTool({
      name: 'create_video',
      description:
        'Render a short video (MP4, GIF or WebM) from an HTML composition with HyperFrames, on this PC. The html is one page: a root <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="10"> in <body>; timed children carry data-start and data-duration (class="clip"); animate with one paused GSAP timeline registered as window.__timelines["main"]. No clocks, Math.random or network; scripts and fonts only from cdn.jsdelivr.net, unpkg.com, cdnjs or Google Fonts; images as data: URLs. Load the hyperframes-core skill first for anything beyond simple titles. Asks sir first; saves under Videos\\Jarvis.',
      input: z.object({
        title: z.string().min(2).max(80),
        html: z.string().min(80).max(300_000),
        quality: z.enum(['draft', 'looks', 'delivery']).default('looks'),
        format: z.enum(FORMATS).default('mp4'),
      }),
      tier: 'CONFIRM',
      timeoutMs: RENDER_TIMEOUT_MS + 60_000,
      summarize: ({ title, format }) => `Make the video "${title.slice(0, 50)}" (${format})`,
      guards: () => ({ paths: [deps.videosDir()] }),
      // Sir sees what will run, not just its title.
      confirm: ({ title, quality, format, html }) => ({
        title: `Make the video "${title.slice(0, 60)}"?`,
        actionLabel: 'Render video',
        details: `<!-- HyperFrames renders this on this PC (${format}, ${quality} quality) into ${deps.videosDir()}. The first time, npx downloads HyperFrames (about 60 MB); rendering can take a few minutes. -->\n${html.slice(0, PREVIEW_CHARS)}${html.length > PREVIEW_CHARS ? `\n… (${html.length - PREVIEW_CHARS} more characters)` : ''}`,
        detailsKind: 'code',
      }),
      async run({ title, html, quality, format }, ctx) {
        const problem = checkComposition(html);
        if (problem) return fail(`${problem} Fix the HTML and try again.`);
        const node = await env.node();
        if (!node || !nodeRunsHyperFrames(node.version))
          return fail(
            `HyperFrames needs Node.js 22 or later on this PC (found ${node?.version ?? 'none'}). Sir can install it from nodejs.org or with: winget install OpenJS.NodeJS.LTS`,
          );
        if (!(await env.ffmpeg()))
          return fail(
            'HyperFrames needs FFmpeg to encode video, and it is not installed. Sir can install it with: winget install --id Gyan.FFmpeg -e (then restart Jarvis).',
          );
        const dir = join(deps.videosDir(), `${stamp()} ${videoSlug(title)}`);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'index.html'), html, 'utf8');
        const output = join(dir, `${videoSlug(title)}.${format}`);
        const r = await env.render(
          ['render', '.', '--output', output, '--quality', quality, '--format', format, '--quiet'],
          dir,
          ctx.signal,
        );
        if (r.code !== 0 || !existsSync(output))
          return fail(
            `The render failed (exit ${String(r.code)}). HyperFrames said:\n${r.out.slice(-MAX_LOG)}\n\nThe composition is saved at ${join(dir, 'index.html')}; fix it and try again.`,
          );
        const size = (await stat(output)).size;
        return ok(
          `Video saved: ${output} (${(size / 1e6).toFixed(1)} MB). The composition is beside it as index.html.`,
        );
      },
    }),
  ];
}
