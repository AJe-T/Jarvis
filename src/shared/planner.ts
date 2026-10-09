import { z } from 'zod';

/**
 * Tasks and Calendar (PRD F25/F26). Times are local wall-clock strings ("2026-10-09T17:30"), not UTC:
 * one person on one PC, and recurrence stays right across daylight-saving changes.
 */
/** A real calendar day (no 31 February) between 1970 and 2200. */
function realDate(s: string): boolean {
  const [y = 0, m = 0, d = 0] = s.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return y >= 1970 && y <= 2200 && date.getMonth() === m - 1 && date.getDate() === d;
}
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(realDate, 'Not a real date');
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const LocalStamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
  .refine(realDate, 'Not a real date');

export const RecurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(366),
  /** Weekly only: 0 = Sunday … 6 = Saturday. Empty or missing = the start's weekday. */
  byDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: LocalDate.optional(),
  count: z.number().int().min(1).max(1000).optional(),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const TodoId = z.string().regex(/^td_[\w-]{4,40}$/);
export const ListId = z.string().regex(/^tl_[\w-]{4,40}$/);
export const CalendarId = z.string().regex(/^cal_[\w-]{4,40}$/);
export const EventId = z.string().regex(/^ev_[\w-]{4,40}$/);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Tag = z.string().trim().min(1).max(40);

export const TODO_STATUSES = ['todo', 'doing', 'done'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TodoListSchema = z.object({
  id: ListId,
  name: z.string().trim().min(1).max(60),
  color: Color,
  icon: z.string().max(16),
  sortOrder: z.number(),
});
export type TodoList = z.infer<typeof TodoListSchema>;

export const TodoSchema = z.object({
  id: TodoId,
  /** null = Inbox. */
  listId: ListId.nullable(),
  /** Set on subtasks. */
  parentId: TodoId.nullable(),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000),
  status: z.enum(TODO_STATUSES),
  /** 1 = urgent … 4 = none (Todoist style). */
  priority: z.number().int().min(1).max(4),
  dueDate: LocalDate.nullable(),
  dueTime: LocalTime.nullable(),
  durationMin: z.number().int().min(5).max(1440).nullable(),
  remindAt: LocalStamp.nullable(),
  recurrence: RecurrenceSchema.nullable(),
  tags: z.array(Tag).max(20),
  starred: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type Todo = z.infer<typeof TodoSchema>;

/** Create (no id) or patch (id + the fields to change). */
export const TodoPatchSchema = TodoSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
})
  .partial()
  .extend({ id: TodoId.optional() });
export type TodoPatch = z.infer<typeof TodoPatchSchema>;

export const CalendarSchema = z.object({
  id: CalendarId,
  name: z.string().trim().min(1).max(60),
  color: Color,
  visible: z.boolean(),
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const EventSchema = z.object({
  id: EventId,
  calendarId: CalendarId,
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(20_000),
  location: z.string().max(300),
  start: LocalStamp,
  end: LocalStamp,
  allDay: z.boolean(),
  recurrence: RecurrenceSchema.nullable(),
  /** Dates (YYYY-MM-DD) of occurrences Sir deleted from a repeating event. */
  exdates: z.array(LocalDate).max(500),
  /** Minutes before the start to remind (0 = at the start). */
  reminders: z.array(z.number().int().min(0).max(40_320)).max(5),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalEvent = z.infer<typeof EventSchema>;

export const EventPatchSchema = EventSchema.omit({ id: true, createdAt: true, updatedAt: true })
  .partial()
  .extend({ id: EventId.optional() });
export type EventPatch = z.infer<typeof EventPatchSchema>;

/** Colours offered for lists and calendars (they also read on the dark canvas). */
export const PLANNER_COLORS = [
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#60a5fa',
  '#fb7185',
  '#f97316',
  '#a3e635',
  '#94a3b8',
] as const;
