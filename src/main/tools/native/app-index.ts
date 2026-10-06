import { readdir } from 'node:fs/promises';
import path from 'node:path';
import Fuse from 'fuse.js';
import type { OsAdapter } from './os';
import { PS_START_APPS } from './ps-scripts';

export type AppLaunch = { kind: 'lnk'; path: string } | { kind: 'appid'; id: string };
export interface AppEntry {
  name: string;
  launch: AppLaunch;
}

/** Everyday names → Start Menu names (spoken commands rarely use the official name). */
const ALIASES: Record<string, string> = {
  'vs code': 'Visual Studio Code',
  vscode: 'Visual Studio Code',
  code: 'Visual Studio Code',
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  outlook: 'Outlook',
  teams: 'Microsoft Teams',
  terminal: 'Terminal',
  'windows terminal': 'Terminal',
  explorer: 'File Explorer',
  'file explorer': 'File Explorer',
  files: 'File Explorer',
  settings: 'Settings',
  calculator: 'Calculator',
  notepad: 'Notepad',
  paint: 'Paint',
  'task manager': 'Task Manager',
  cmd: 'Command Prompt',
};

const NOISE = /\b(uninstall|readme|help|website|documentation|license|release notes|manual)\b/i;

export function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

async function walkLnk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkLnk(full, depth + 1)));
    else if (e.name.toLowerCase().endsWith('.lnk')) out.push(full);
  }
  return out;
}

/** API-Guide.md §2.3: Start Menu shortcuts + Get-StartApps (Store apps), fuzzy matched with fuse.js. */
export function createAppIndex(osa: OsAdapter, startMenuDirs: string[], ttlMs = 10 * 60_000) {
  let apps: AppEntry[] = [];
  let fuse: Fuse<AppEntry> | null = null;
  let loadedAt = 0;

  async function refresh(): Promise<void> {
    const byName = new Map<string, AppEntry>();
    for (const dir of startMenuDirs) {
      for (const file of await walkLnk(dir)) {
        const name = path.basename(file, '.lnk');
        if (!NOISE.test(name) && !byName.has(name.toLowerCase()))
          byName.set(name.toLowerCase(), { name, launch: { kind: 'lnk', path: file } });
      }
    }
    type StartApp = { Name: string; AppID: string };
    const startApps = asArray<StartApp>(
      await osa.psJson<StartApp[] | StartApp>(PS_START_APPS).catch((): StartApp[] => []),
    );
    for (const a of startApps) {
      if (!a?.Name || !a.AppID || NOISE.test(a.Name) || byName.has(a.Name.toLowerCase())) continue;
      byName.set(a.Name.toLowerCase(), { name: a.Name, launch: { kind: 'appid', id: a.AppID } });
    }
    apps = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    fuse = new Fuse(apps, {
      keys: ['name'],
      threshold: 0.35,
      ignoreLocation: true,
      includeScore: true,
    });
    loadedAt = Date.now();
  }

  async function ensure(): Promise<void> {
    if (!fuse || Date.now() - loadedAt > ttlMs) await refresh();
  }

  function lookup(query: string): AppEntry | null {
    const q = query
      .trim()
      .toLowerCase()
      .replace(/\.exe$/, '');
    const target = (ALIASES[q] ?? q).toLowerCase();
    const exact = apps.find((a) => a.name.toLowerCase() === target);
    if (exact) return exact;
    const prefix = apps
      .filter((a) => a.name.toLowerCase().startsWith(target))
      .sort((a, b) => a.name.length - b.name.length)[0];
    if (prefix) return prefix;
    return fuse?.search(target)[0]?.item ?? null;
  }

  return {
    refresh,
    async find(query: string): Promise<AppEntry | null> {
      await ensure();
      return lookup(query);
    },
    async suggest(query: string, n = 3): Promise<string[]> {
      await ensure();
      return (fuse?.search(query, { limit: n }) ?? []).map((r) => r.item.name);
    },
    async list(query?: string): Promise<string[]> {
      await ensure();
      return query
        ? (fuse?.search(query, { limit: 30 }) ?? []).map((r) => r.item.name)
        : apps.map((a) => a.name);
    },
  };
}

export type AppIndex = ReturnType<typeof createAppIndex>;
