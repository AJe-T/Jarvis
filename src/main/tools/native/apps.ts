import Fuse from 'fuse.js';
import { z } from 'zod';
import { ToolError } from '../../errors';
import { defineTool, fail, ok, type Tool } from '../types';
import { asArray, type AppIndex } from './app-index';
import type { OsAdapter } from './os';
import {
  PS_CLOSE_WINDOWS,
  PS_LIST_WINDOWS,
  PS_PROCESSES,
  PS_STOP_PROCESSES,
  PS_WINDOW_ACTION,
} from './ps-scripts';

interface WindowInfo {
  Id: number;
  ProcessName: string;
  MainWindowTitle: string;
}

/** Processes Jarvis must never kill (Security.md §4.2: system integrity). */
const CRITICAL = new Set([
  'system',
  'idle',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'lsaiso',
  'svchost',
  'dwm',
  'explorer',
  'fontdrvhost',
  'msmpeng',
  'securityhealthservice',
  'spoolsv',
  'registry',
  'memory compression',
  'jarvis',
  'electron',
]);

const APPID_RE = /^[\w.!{}\-\\ ]{1,300}$/;

async function windows(osa: OsAdapter, signal: AbortSignal): Promise<WindowInfo[]> {
  return asArray(await osa.psJson<WindowInfo[] | WindowInfo>(PS_LIST_WINDOWS, { signal }));
}

function matchWindow(list: WindowInfo[], query: string): WindowInfo | undefined {
  const q = query.toLowerCase();
  const direct = list.find(
    (w) => w.ProcessName.toLowerCase() === q || w.MainWindowTitle.toLowerCase() === q,
  );
  if (direct) return direct;
  const fuse = new Fuse(list, {
    keys: ['ProcessName', 'MainWindowTitle'],
    threshold: 0.4,
    ignoreLocation: true,
  });
  return fuse.search(query)[0]?.item;
}

const name = z.object({ name: z.string().min(1).max(100) });

export function createAppTools(osa: OsAdapter, index: AppIndex): Tool[] {
  const windowAction = (action: 'focus' | 'minimize' | 'maximize', verb: string) =>
    defineTool({
      name: `${action === 'focus' ? 'focus' : action}_window`,
      description: `${verb} an open window, matched by app name or window title (e.g. "Chrome", "Spotify", "report.docx"). Use list_open_windows if unsure.`,
      input: name,
      tier: 'SAFE',
      summarize: (i: { name: string }) => `${verb} ${i.name}`,
      async run(i: { name: string }, ctx) {
        const w = matchWindow(await windows(osa, ctx.signal), i.name);
        if (!w) return fail(`No open window matches "${i.name}".`);
        await osa.psJson(PS_WINDOW_ACTION, { params: { pid: w.Id, action }, signal: ctx.signal });
        return ok(`${verb === 'Switch to' ? 'Switched to' : `${verb}d`} ${w.MainWindowTitle}.`);
      },
    });

  return [
    defineTool({
      name: 'list_installed_apps',
      description:
        'List installed apps (Start Menu + Store apps), optionally filtered by a fuzzy query. Use before open_app when unsure of the exact name.',
      input: z.object({ query: z.string().max(100).optional() }),
      tier: 'SAFE',
      timeoutMs: 30_000,
      summarize: ({ query }) => (query ? `Find apps matching "${query}"` : 'List installed apps'),
      async run({ query }) {
        const names = await index.list(query);
        return ok(names.length ? names.slice(0, 200).join('\n') : 'No matching apps.');
      },
    }),
    defineTool({
      name: 'open_app',
      description:
        'Open an installed Windows application by its everyday name (e.g. "VS Code", "Spotify", "Calculator"). Use list_installed_apps first if unsure. Do not use for websites; use open_url.',
      input: name,
      tier: 'SAFE',
      timeoutMs: 30_000,
      summarize: ({ name: n }) => `Open ${n}`,
      async run({ name: n }) {
        const match = await index.find(n);
        if (!match) {
          const close = await index.suggest(n);
          return fail(
            `No installed app matches "${n}".${close.length ? ` Closest: ${close.join(', ')}.` : ''} It may not be installed; a website might work instead.`,
          );
        }
        if (match.launch.kind === 'lnk') await osa.openPath(match.launch.path);
        else {
          if (!APPID_RE.test(match.launch.id))
            throw new ToolError('That app has an unusual ID; open it from the Start Menu.');
          await osa.run('explorer.exe', [`shell:AppsFolder\\${match.launch.id}`]);
        }
        return ok(`Opened ${match.name}.`);
      },
    }),
    defineTool({
      name: 'close_app',
      description:
        'Close an app gracefully (like clicking X), matched by app or window name. The app may ask to save. Requires confirmation.',
      input: name,
      tier: 'CONFIRM',
      destructive: true,
      summarize: ({ name: n }) => `Close ${n}`,
      confirm: ({ name: n }) => ({
        title: `Close ${n}?`,
        actionLabel: `Close ${n}`,
        details: 'Unsaved work may be lost if the app does not prompt to save.',
        detailsKind: 'text',
      }),
      async run({ name: n }, ctx) {
        const list = await windows(osa, ctx.signal);
        const first = matchWindow(list, n);
        if (!first) return fail(`No open window matches "${n}".`);
        const ids = list.filter((w) => w.ProcessName === first.ProcessName).map((w) => w.Id);
        const r = await osa.psJson<{ closed: string[] | string }>(PS_CLOSE_WINDOWS, {
          params: { ids },
          signal: ctx.signal,
        });
        return asArray(r.closed).length
          ? ok(`Asked ${first.ProcessName} to close.`)
          : fail(`${first.ProcessName} did not accept the close request.`);
      },
    }),
    defineTool({
      name: 'kill_process',
      description:
        'Force-stop a process by name or PID when an app is frozen. Unsaved work is lost. Prefer close_app. System processes are never allowed.',
      input: z
        .object({
          name: z.string().min(1).max(100).optional(),
          pid: z.number().int().positive().optional(),
        })
        .refine((v) => v.name ?? v.pid, 'Give a name or pid'),
      tier: (i) =>
        i.name && CRITICAL.has(i.name.toLowerCase().replace(/\.exe$/, '')) ? 'BLOCKED' : 'CONFIRM',
      destructive: true,
      summarize: (i) => `Force-stop ${i.name ?? `process ${i.pid}`}`,
      confirm: (i) => ({
        title: `Force-stop ${i.name ?? `process ${i.pid}`}?`,
        actionLabel: 'Force stop',
        details: 'Any unsaved work in it will be lost.',
        detailsKind: 'text',
      }),
      async run(i, ctx) {
        const all = asArray(
          await osa.psJson<WindowInfo[] | WindowInfo>(PS_PROCESSES, { signal: ctx.signal }),
        );
        const target = i.pid
          ? all.filter((p) => p.Id === i.pid)
          : all.filter(
              (p) =>
                p.ProcessName.toLowerCase() === (i.name ?? '').toLowerCase().replace(/\.exe$/, ''),
            );
        if (target.length === 0) return fail('No such process is running.');
        if (target.some((p) => CRITICAL.has(p.ProcessName.toLowerCase()) || p.Id === process.pid))
          return fail('That is a protected system process; Jarvis will not stop it.');
        const r = await osa.psJson<{ stopped: string[] | string }>(PS_STOP_PROCESSES, {
          params: { ids: target.map((p) => p.Id) },
          signal: ctx.signal,
        });
        return ok(`Stopped ${asArray(r.stopped).length} process(es).`);
      },
    }),
    defineTool({
      name: 'list_open_windows',
      description:
        'List open app windows (process name and title). Use to find the right window before focusing or closing.',
      input: z.object({}).strict(),
      tier: 'SAFE',
      summarize: () => 'List open windows',
      async run(_i, ctx) {
        const list = await windows(osa, ctx.signal);
        return ok(
          list.length
            ? list.map((w) => `${w.ProcessName}: ${w.MainWindowTitle}`).join('\n')
            : 'No windows are open.',
        );
      },
    }),
    windowAction('focus', 'Switch to'),
    windowAction('minimize', 'Minimize'),
    windowAction('maximize', 'Maximize'),
  ];
}
