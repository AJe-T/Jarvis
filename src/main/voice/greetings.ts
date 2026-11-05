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

/**
 * Said only when the real answer is slow to start (see voice-controller ACK_DELAY_MS), and worded
 * for what was asked: "can you hear me" gets nothing, "what did we decide earlier" gets "let me
 * think back", not a stock "working on it".
 */
export const WORKING_LINE_SETS = {
  recall: ['Let me think back, sir.', 'Give me a moment to recall, sir.'],
  lookup: ['Checking now, sir.', 'Let me look that up, sir.'],
  action: ['On it, sir.', 'Right away, sir.'],
  long: ['Give me a moment to work through that, sir.', 'Working through that now, sir.'],
  general: ['One moment, sir.', 'Let me see, sir.'],
} as const;
export type WorkingKind = keyof typeof WORKING_LINE_SETS;

/** Every working line, for rendering them ahead of time. */
export const WORKING_LINES: readonly string[] = Object.values(WORKING_LINE_SETS).flat();

/** Chit-chat and "are you there?" checks: answered quickly, and a filler would only get in the way. */
const SMALL_TALK =
  /^(?:(?:hey|hi|hello|ok|okay|good (?:morning|afternoon|evening|night))\b.{0,12}$|(?:(?:can|do) you )?hear me|are you (?:there|listening|awake|on)\b|(?:thanks?|thank you|how are you|testing|yes|no|nothing)\b.{0,12}$)/;
const RECALL =
  /\b(?:earlier|before|last time|yesterday|we (?:talked|discussed|spoke|said|decided)|you (?:said|told|mentioned|suggested)|i (?:said|told you|asked)|remember|recall|what did (?:i|we|you))\b/;
const LOOKUP =
  /\b(?:search|look (?:up|for)|google|find out|research|news|weather|forecast|latest|price|score|who (?:is|was)|check (?:my|the|if|whether))\b/;
const ACTION =
  /^(?:open|close|send|create|make|set|start|stop|play|write|add|schedule|remind|book|turn|delete|move|save|email|message|call|launch|show|draft|run)\b/;
const LONG_WORDS = 18;

/** Which kind of working line fits the request; null when none should be said. */
export function workingKind(said: string): WorkingKind | null {
  const t = said
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/^(?:(?:hey|ok|okay)\s+)?jarvis[\s,.!:-]*/, '')
    .replace(/^(?:(?:can|could|would) you|please)\s+/, '')
    .trim();
  if (!t || SMALL_TALK.test(t)) return null;
  if (RECALL.test(t)) return 'recall';
  if (LOOKUP.test(t)) return 'lookup';
  if (t.split(/\s+/).length > LONG_WORDS) return 'long';
  if (ACTION.test(t)) return 'action';
  return 'general';
}

/** A working line that fits `said`, never the same one twice in a row; null = say nothing. */
export function createWorkingLinePicker(
  random: () => number = Math.random,
): (said: string) => string | null {
  const pickers = Object.fromEntries(
    Object.entries(WORKING_LINE_SETS).map(([k, lines]) => [k, createLinePicker(lines, random)]),
  ) as Record<WorkingKind, () => string>;
  return (said) => {
    const kind = workingKind(said);
    return kind ? pickers[kind]() : null;
  };
}

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
