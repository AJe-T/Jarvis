import { z } from 'zod';
import type { Scheduler } from '../../scheduler/scheduler';
import { defineTool, fail, ok, type Tool } from '../types';
import type { OsAdapter } from './os';

function when(d: Date): string {
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** open_url, clipboard, notifications, timers and reminders. */
export function createMiscTools(osa: OsAdapter, scheduler: Scheduler): Tool[] {
  return [
    defineTool({
      name: 'open_url',
      description:
        "Open a web page (http/https only) in sir's default browser. For search, open a search URL (e.g. https://www.youtube.com/results?search_query=lofi). Use Playwright tools instead when you need to read or click the page.",
      input: z.object({ url: z.string().min(4).max(2000) }),
      tier: 'SAFE',
      externalFacing: true,
      summarize: ({ url }) => `Open ${url.replace(/^https?:\/\//, '').slice(0, 60)}`,
      guards: ({ url }) => ({ urls: [{ url, allowPrivate: true }] }),
      async run({ url }) {
        await osa.openExternal(url);
        return ok(`Opened ${url} in the browser.`);
      },
    }),
    defineTool({
      name: 'read_clipboard',
      description:
        'Read the text currently on the clipboard. Requires confirmation because the clipboard may hold passwords.',
      input: z.object({}).strict(),
      tier: 'CONFIRM',
      untrustedOutput: true,
      summarize: () => 'Read the clipboard',
      confirm: () => ({
        title: 'Let Jarvis read the clipboard?',
        actionLabel: 'Read clipboard',
        details: 'The clipboard text will be sent to Claude.',
        detailsKind: 'text',
      }),
      async run() {
        const text = await osa.clipboardRead();
        return text
          ? { content: [{ type: 'text', text }], untrustedSource: 'clipboard' }
          : ok('The clipboard has no text.');
      },
    }),
    defineTool({
      name: 'write_clipboard',
      description: 'Put text on the clipboard so sir can paste it.',
      input: z.object({ text: z.string().min(1).max(100_000) }),
      tier: 'SAFE',
      summarize: ({ text }) =>
        `Copy "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}" to the clipboard`,
      async run({ text }) {
        await osa.clipboardWrite(text);
        return ok('Copied to the clipboard.');
      },
    }),
    defineTool({
      name: 'show_notification',
      description: 'Show a Windows notification with a short title and message.',
      input: z.object({ title: z.string().min(1).max(80), body: z.string().max(300).default('') }),
      tier: 'SAFE',
      summarize: ({ title }) => `Show notification "${title}"`,
      async run({ title, body }) {
        osa.notify(title, body);
        return ok('Notification shown.');
      },
    }),
    defineTool({
      name: 'set_timer',
      description:
        'Start a countdown timer. When it ends sir gets a notification (and a spoken alert in voice mode).',
      input: z
        .object({
          minutes: z.number().min(0).max(1440).default(0),
          seconds: z.number().min(0).max(86_400).default(0),
          label: z.string().max(100).default('Timer'),
        })
        .refine((v) => v.minutes * 60 + v.seconds >= 1, 'Timer must be at least 1 second'),
      tier: 'SAFE',
      summarize: ({ minutes, seconds, label }) =>
        `Set a ${minutes ? `${minutes} min ` : ''}${seconds ? `${seconds} s ` : ''}timer${label !== 'Timer' ? ` (${label})` : ''}`,
      async run({ minutes, seconds, label }, ctx) {
        const due = new Date(Date.now() + (minutes * 60 + seconds) * 1000);
        scheduler.add(`${label} is done.`, due, ctx.conversationId);
        return ok(`Timer set for ${when(due)}.`);
      },
    }),
    defineTool({
      name: 'set_reminder',
      description:
        'Remind sir about something at a specific time. Give dueAt as an ISO 8601 date-time with offset (compute it from the current date/time in your context, e.g. "in 10 minutes" or "at 6 pm"). Fires even if the window is hidden.',
      input: z.object({
        text: z.string().min(1).max(300),
        dueAt: z.iso.datetime({ offset: true, local: true }),
      }),
      tier: 'SAFE',
      summarize: ({ text }) => `Remind: ${text.slice(0, 50)}`,
      async run({ text, dueAt }, ctx) {
        const due = new Date(dueAt);
        if (Number.isNaN(due.getTime())) return fail('That date/time could not be understood.');
        if (due.getTime() < Date.now() - 60_000) return fail('That time is in the past.');
        const r = scheduler.add(text, due, ctx.conversationId);
        return ok(`Reminder set for ${when(due)} (id ${r.id}).`);
      },
    }),
    defineTool({
      name: 'list_reminders',
      description: 'List upcoming reminders and timers with their ids.',
      input: z.object({}).strict(),
      tier: 'SAFE',
      summarize: () => 'List reminders',
      async run() {
        const list = scheduler.upcoming();
        return ok(
          list.length
            ? list.map((r) => `${r.id}: ${r.text} — ${when(new Date(r.due_at))}`).join('\n')
            : 'No upcoming reminders.',
        );
      },
    }),
    defineTool({
      name: 'cancel_reminder',
      description: 'Cancel an upcoming reminder or timer by id (get ids from list_reminders).',
      input: z.object({ id: z.string().min(3).max(40) }),
      tier: 'SAFE',
      summarize: ({ id }) => `Cancel reminder ${id}`,
      async run({ id }) {
        return scheduler.cancel(id)
          ? ok('Reminder cancelled.')
          : fail('No upcoming reminder has that id.');
      },
    }),
  ];
}
