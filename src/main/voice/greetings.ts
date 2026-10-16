/**
 * Instant spoken lines that need no model call: said the moment Jarvis is woken, or while a
 * request goes to the model, so Sir hears an answer in well under a second.
 */
import type { Todo } from '@shared/planner';
import { toDateKey } from '@shared/planner-time';
import type { AgendaItem } from '../planner/planner';

/** Woken by name or wake word: Jarvis listens once this has been said. */
export const WAKE_LINES = [
  'Yes, sir?',
  "I'm listening, sir.",
  'At your service, sir.',
  'What can I do for you, sir?',
  'Go ahead, sir.',
  'Sir?',
] as const;

/** A request is on its way to the model; the real answer follows. */
export const WORKING_LINES = [
  'On it, sir.',
  'Right away, sir.',
  'Working on it, sir.',
  'Looking into it, sir.',
  'One moment, sir.',
  'Give me a second, sir.',
] as const;

/** What the startup hello mentions (from the planner; nothing is fetched). */
export interface StartupFacts {
  now: Date;
  /** Today's calendar events not yet over: title and local start ("2026-10-17T10:00", or a date if all day). */
  events: Array<{ title: string; start: string; allDay: boolean }>;
  tasksDue: number;
  overdue: number;
}

/** Today's facts from the planner: events not over yet, open tasks due today, and overdue ones. */
export function startupFacts(
  planner: {
    agenda(from: string, to: string): AgendaItem[];
    todos(): Array<Pick<Todo, 'dueDate' | 'status' | 'parentId'>>;
  },
  now = new Date(),
): StartupFacts {
  const today = toDateKey(now);
  const stamp = `${today}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const events = planner
    .agenda(today, today)
    .filter((i) => i.kind === 'event' && (i.allDay || (i.end ?? i.start) >= stamp));
  const open = planner.todos().filter((t) => !t.parentId && t.status !== 'done' && t.dueDate);
  return {
    now,
    events,
    tasksDue: open.filter((t) => t.dueDate === today).length,
    overdue: open.filter((t) => (t.dueDate ?? '') < today).length,
  };
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n === 1 ? 'one' : n} ${n === 1 ? one : many}`;

/**
 * The spoken hello when Jarvis starts: greeting by time of day, the time, and today's plan in one
 * or two sentences. Ends with a question because the mic opens right after it.
 */
export function startupLine(f: StartupFacts): string {
  const h = f.now.getHours();
  const part = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const time = f.now.toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const parts: string[] = [`Good ${part}, sir. It's ${time}.`];
  const timed = f.events.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
  const next = timed[0];
  if (f.events.length)
    parts.push(
      `You have ${plural(f.events.length, 'event')} today${next ? `, starting with ${next.title} at ${next.start.slice(11, 16)}` : ''}.`,
    );
  const todo = [
    f.tasksDue ? `${plural(f.tasksDue, 'task')} due` : '',
    f.overdue ? `${f.overdue} overdue` : '',
  ].filter(Boolean);
  if (todo.length) parts.push(`${todo.join(', and ')}.`.replace(/^./, (c) => c.toUpperCase()));
  if (!f.events.length && !todo.length) parts.push('Your day is clear.');
  parts.push('What shall we do?');
  return parts.join(' ');
}

/** A random line, never the same one twice in a row. */
export function createLinePicker(
  lines: readonly string[],
  random: () => number = Math.random,
): () => string {
  let last = -1;
  return () => {
    let i = Math.floor(random() * lines.length);
    if (i === last && lines.length > 1) i = (i + 1) % lines.length;
    last = i;
    return lines[i] as string;
  };
}
