import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { StagePanelSchema, type StagePanel } from '@shared/stage';
import type { Tier } from '@shared/types';
import { ToolError } from '../errors';
import type { PathGuard } from '../security/path-guard';
import { SENSITIVE_FILE } from '../tools/native/files';
import { defineTool, fail, ok, type Tool } from '../tools/types';

const TIMEOUT_MS = 2_000;
const FILE_TIMEOUT_MS = 15_000;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;
/** What fits in a note panel; longer files are cut with a notice. */
const MAX_NOTE = 50_000;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const TEXT_TYPES = new Set(['.md', '.markdown', '.txt', '.log', '.csv', '.json', '.yaml', '.yml']);

/**
 * A file → the panel that shows it: pictures as images, pages / drawings / diagrams in the
 * artifact sandbox (no network), text as a note. Null for kinds it can't show.
 */
export function panelForFile(file: string, data: Buffer): StagePanel | null {
  const ext = path.extname(file).toLowerCase();
  const title = path.basename(file).slice(0, 80) || 'File';
  const mime = IMAGE_TYPES[ext];
  if (mime) return { kind: 'image', title, src: `data:${mime};base64,${data.toString('base64')}` };
  if (data.includes(0)) return null;
  const text = data.toString('utf8');
  if (ext === '.html' || ext === '.htm')
    return { kind: 'artifact', title, format: 'html', code: text.slice(0, 200_000) };
  if (ext === '.svg')
    return { kind: 'artifact', title, format: 'svg', code: text.slice(0, 200_000) };
  if (ext === '.mmd' || ext === '.mermaid')
    return { kind: 'artifact', title, format: 'mermaid', code: text.slice(0, 200_000) };
  if (!TEXT_TYPES.has(ext)) return null;
  const cut = text.length > MAX_NOTE;
  const body = ext === '.md' || ext === '.markdown' ? text : `\`\`\`\n${text}\n\`\`\``;
  return {
    kind: 'note',
    title,
    markdown: cut ? `${body.slice(0, MAX_NOTE - 80)}\n\n…(cut: the file is longer)` : body,
  };
}

/**
 * show_panel / hide_panel / show_file (Design-system.md §5.2a): Jarvis moves the orb aside and shows
 * a panel on his main screen. Display only (nothing leaves the PC, nothing changes), so SAFE.
 */
export function createStageTools(
  show: (panel: StagePanel | null) => void,
  guard?: PathGuard,
): Tool[] {
  const tools: Tool[] = [
    defineTool({
      name: 'show_panel',
      description:
        "Show a panel on sir's main screen beside the orb, when he asks to see or display something, or to present what you made. kind: 'pomodoro' (focus timer: minutes, breakMinutes), 'usage' (AI usage and billing), 'status' (Jarvis dashboard), 'system' (live PC monitor: CPU, memory, disk, battery), 'qr' (title + text: a QR code for a link, Wi-Fi login as WIFI:T:WPA;S:<name>;P:<password>;;, contact or any text; drawn on this PC), 'list' (title + items, e.g. tasks or an agenda), 'stats' (title + labelled values, optional percent), 'note' (title + Markdown: a document or summary), 'artifact' (title + format html|svg|mermaid + code: a page, illustration or diagram, run with no network), 'today' (sir's tasks and events today), 'calculator' (expression: when sir asks you to work something out, e.g. \"what is 2+2\", \"15% of 2400\", show it with the expression and say the answer), 'converter' (units), 'clock' (world clock), 'timers' (countdowns, reminders, stopwatch), 'scratchpad' (shared notes), 'browser' (Jarvis Browser), 'terminal' (Jarvis Terminal), 'camera' (live webcam; asks sir first). Replaces any panel already shown. Keep spoken replies short; the panel carries the detail.",
      input: z.object({ panel: StagePanelSchema }),
      // Showing the camera turns it on: sir says yes first.
      tier: ({ panel }): Tier => (panel.kind === 'camera' ? 'CONFIRM' : 'SAFE'),
      timeoutMs: TIMEOUT_MS,
      // A Wi-Fi QR carries its password: the summary (activity log, confirmations) never shows it.
      summarize: ({ panel }) =>
        `Show ${'title' in panel ? `"${panel.title}"` : panel.kind} on screen`.replace(
          /(WIFI:|;)P:(?:\\.|[^;])*/gi,
          '$1P:••••••',
        ),
      async run({ panel }) {
        show(panel);
        return Promise.resolve(ok(`Showing the ${panel.kind} panel beside the orb.`));
      },
    }),
    defineTool({
      name: 'hide_panel',
      description: "Close the panel on sir's main screen and bring the orb back to the centre.",
      input: z.object({}).strict(),
      tier: 'SAFE',
      timeoutMs: TIMEOUT_MS,
      summarize: () => 'Close the panel on screen',
      async run() {
        show(null);
        return Promise.resolve(ok('Panel closed.'));
      },
    }),
  ];
  if (!guard) return tools;
  tools.push(
    defineTool({
      name: 'show_file',
      description:
        'Show a file from the allowed folders beside the orb: a picture (.png .jpg .webp .gif, ≤ 8 MB, e.g. one you generated or a screenshot), a page or drawing (.html .svg .mmd, run with no network) or a text document (.md .txt .csv .json .yaml .log). Use it after creating an image or document so sir sees it. Nothing is sent anywhere and the contents are not returned to you (use read_text_file for that).',
      input: z.object({ path: z.string().min(3).max(1024) }),
      tier: ({ path: p }): Tier => (SENSITIVE_FILE.test(p) ? 'CONFIRM' : 'SAFE'),
      timeoutMs: FILE_TIMEOUT_MS,
      summarize: ({ path: p }) => `Show ${path.basename(p)} on screen`,
      guards: ({ path: p }) => ({ paths: [p] }),
      async run({ path: p }) {
        const file = guard.resolve(p);
        const handle = await open(file, 'r').catch(() => {
          throw new ToolError(`Can't open ${file}: it doesn't exist or isn't readable.`);
        });
        try {
          const s = await handle.stat();
          if (s.isDirectory()) return fail(`${file} is a folder, not a file.`);
          const limit = IMAGE_TYPES[path.extname(file).toLowerCase()] ? MAX_IMAGE : MAX_TEXT;
          if (s.size > limit)
            return fail(
              `${path.basename(file)} is ${(s.size / 1024 / 1024).toFixed(1)} MB; the limit is ${limit / 1024 / 1024} MB.`,
            );
          const panel = panelForFile(file, await handle.readFile());
          if (!panel)
            return fail(
              `Can't show ${path.basename(file)} here (pictures, .html/.svg/.mmd pages and text files only). Offer to open it with open_path instead.`,
            );
          show(StagePanelSchema.parse(panel));
          return ok(`Showing ${path.basename(file)} beside the orb.`);
        } finally {
          await handle.close();
        }
      },
    }),
  );
  return tools;
}
