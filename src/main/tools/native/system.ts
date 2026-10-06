import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { z } from 'zod';
import { defineTool, fail, ok, type Tool } from '../types';
import type { OsAdapter } from './os';
import { PS_BATTERY, PS_SET_BRIGHTNESS, PS_SET_MUTE, PS_SET_VOLUME, PS_SLEEP } from './ps-scripts';

const empty = z.object({}).strict();

async function cpuPercent(): Promise<number> {
  const sample = (): { idle: number; total: number } =>
    os.cpus().reduce(
      (a, c) => {
        const t = c.times;
        return { idle: a.idle + t.idle, total: a.total + t.idle + t.user + t.sys + t.irq + t.nice };
      },
      { idle: 0, total: 0 },
    );
  const a = sample();
  await new Promise((r) => setTimeout(r, 250));
  const b = sample();
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 100) : 0;
}

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function createSystemTools(osa: OsAdapter): Tool[] {
  return [
    defineTool({
      name: 'get_datetime',
      description:
        'Get the current local date, time and time zone. Use when sir asks the time or date, or before scheduling something relative to now.',
      input: empty,
      tier: 'SAFE',
      summarize: () => 'Check the date and time',
      async run() {
        const now = new Date();
        return ok(
          `${now.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}); ISO ${now.toISOString()}`,
        );
      },
    }),
    defineTool({
      name: 'get_system_info',
      description:
        'Get CPU usage, memory, uptime, disk space and OS version of this PC. Use for "how is my PC doing" questions. Not for battery (use get_battery).',
      input: empty,
      tier: 'SAFE',
      timeoutMs: 10_000,
      summarize: () => 'Check system status',
      async run() {
        const cpu = await cpuPercent();
        const disk = await statfs('C:\\').catch(() => null);
        const lines = [
          `OS: ${os.version()} (${os.release()})`,
          `CPU: ${os.cpus()[0]?.model.trim() ?? 'unknown'} × ${os.cpus().length}, ${cpu}% busy`,
          `Memory: ${gb(os.totalmem() - os.freemem())} used of ${gb(os.totalmem())}`,
          `Uptime: ${Math.floor(os.uptime() / 3600)} h ${Math.floor((os.uptime() % 3600) / 60)} min`,
        ];
        if (disk)
          lines.push(
            `Disk C: ${gb(disk.bavail * disk.bsize)} free of ${gb(disk.blocks * disk.bsize)}`,
          );
        return ok(lines.join('\n'));
      },
    }),
    defineTool({
      name: 'get_battery',
      description:
        'Get battery charge percentage and whether it is charging. Returns "no battery" on desktop PCs.',
      input: empty,
      tier: 'SAFE',
      summarize: () => 'Check the battery',
      async run(_i, ctx) {
        const b = await osa.psJson<{
          present: boolean;
          percent?: number;
          status?: number;
          minutes?: number;
        }>(PS_BATTERY, { signal: ctx.signal });
        if (!b.present) return ok('This PC has no battery (desktop or AC only).');
        const charging = b.status === 2 || (b.status ?? 0) >= 6;
        const left =
          b.minutes && b.minutes < 10_000 && !charging
            ? `, about ${Math.floor(b.minutes / 60)} h ${b.minutes % 60} min left`
            : '';
        return ok(`Battery at ${b.percent ?? '?'}%${charging ? ', charging' : ''}${left}.`);
      },
    }),
    defineTool({
      name: 'set_volume',
      description:
        'Set the master speaker volume to an exact percentage (0–100). Also unmutes when level > 0.',
      input: z.object({ level: z.number().int().min(0).max(100) }),
      tier: 'SAFE',
      summarize: ({ level }) => `Set volume to ${level}%`,
      async run({ level }, ctx) {
        const r = await osa.psJson<{ level: number }>(PS_SET_VOLUME, {
          params: { level },
          signal: ctx.signal,
        });
        return ok(`Volume is now ${r.level ?? level}%.`);
      },
    }),
    defineTool({
      name: 'mute',
      description: 'Mute or unmute the speakers. Omit "muted" to toggle.',
      input: z.object({ muted: z.boolean().optional() }),
      tier: 'SAFE',
      summarize: ({ muted }) =>
        muted === false ? 'Unmute sound' : muted ? 'Mute sound' : 'Toggle mute',
      async run({ muted }, ctx) {
        const r = await osa.psJson<{ muted: boolean }>(PS_SET_MUTE, {
          params: { muted: muted ?? null },
          signal: ctx.signal,
        });
        return ok(r.muted ? 'Sound muted.' : 'Sound unmuted.');
      },
    }),
    defineTool({
      name: 'media_control',
      description:
        'Control whatever media is playing (Spotify, YouTube in a browser, etc.): play/pause, next, previous or stop. Works like the keyboard media keys.',
      input: z.object({ action: z.enum(['play_pause', 'next', 'previous', 'stop']) }),
      tier: 'SAFE',
      summarize: ({ action }) =>
        ({
          play_pause: 'Play/pause media',
          next: 'Next track',
          previous: 'Previous track',
          stop: 'Stop media',
        })[action],
      async run({ action }) {
        await osa.mediaKey(action);
        return ok('Done.');
      },
    }),
    defineTool({
      name: 'set_brightness',
      description:
        'Set the built-in display brightness (0–100). Works on laptops; external monitors usually do not support it.',
      input: z.object({ level: z.number().int().min(0).max(100) }),
      tier: 'SAFE',
      summarize: ({ level }) => `Set brightness to ${level}%`,
      async run({ level }, ctx) {
        const r = await osa.psJson<{ supported: boolean }>(PS_SET_BRIGHTNESS, {
          params: { level },
          signal: ctx.signal,
        });
        return r.supported
          ? ok(`Brightness set to ${level}%.`)
          : fail('This display does not support brightness control from Windows.');
      },
    }),
    defineTool({
      name: 'lock_screen',
      description: 'Lock the PC (like Win+L). Safe and instant.',
      input: empty,
      tier: 'SAFE',
      summarize: () => 'Lock the PC',
      async run() {
        await osa.run('rundll32.exe', ['user32.dll,LockWorkStation']);
        return ok('PC locked.');
      },
    }),
    defineTool({
      name: 'sleep_pc',
      description: 'Put the PC to sleep. Requires confirmation.',
      input: empty,
      tier: 'CONFIRM',
      destructive: true,
      summarize: () => 'Put the PC to sleep',
      confirm: () => ({
        title: 'Put the PC to sleep?',
        actionLabel: 'Sleep now',
        details: 'Unsaved work stays open; the PC wakes when you press a key or the power button.',
        detailsKind: 'text',
      }),
      async run() {
        // Fire and forget: the process may not return before the PC sleeps.
        void osa.ps(PS_SLEEP).catch(() => undefined);
        return ok('Going to sleep.');
      },
    }),
    defineTool({
      name: 'restart_pc',
      description:
        'Restart Windows in 10 seconds. Requires confirmation. Unsaved work in other apps may be lost.',
      input: empty,
      tier: 'CONFIRM',
      destructive: true,
      summarize: () => 'Restart the PC',
      confirm: () => ({
        title: 'Restart the PC?',
        actionLabel: 'Restart',
        details: 'Windows restarts in 10 seconds. Save your work in other apps first.',
        detailsKind: 'text',
      }),
      async run() {
        await osa.run('shutdown.exe', ['/r', '/t', '10']);
        return ok('Restarting in 10 seconds. (Run "shutdown /a" to cancel.)');
      },
    }),
    defineTool({
      name: 'shutdown_pc',
      description:
        'Shut down Windows in 10 seconds. Requires confirmation. Unsaved work in other apps may be lost.',
      input: empty,
      tier: 'CONFIRM',
      destructive: true,
      summarize: () => 'Shut down the PC',
      confirm: () => ({
        title: 'Shut down the PC?',
        actionLabel: 'Shut down',
        details: 'Windows shuts down in 10 seconds. Save your work in other apps first.',
        detailsKind: 'text',
      }),
      async run() {
        await osa.run('shutdown.exe', ['/s', '/t', '10']);
        return ok('Shutting down in 10 seconds.');
      },
    }),
  ];
}
