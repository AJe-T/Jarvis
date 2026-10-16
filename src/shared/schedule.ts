import { z } from 'zod';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * When an automation runs (main/automation/tasks.ts). Local time, 24 h. `once` is a local
 * "YYYY-MM-DDTHH:mm" (what <input type="datetime-local"> gives); `monthly` on day 29–31 runs on the
 * last day of shorter months; `startup` runs each time Jarvis starts, after a short delay.
 */
export const ScheduleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('daily'),
    time: TIME,
    /** 1 = Monday … 7 = Sunday; empty = every day. */
    days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  }),
  z.object({
    type: z.literal('interval'),
    minutes: z
      .number()
      .int()
      .min(15)
      .max(7 * 24 * 60),
  }),
  z.object({
    type: z.literal('once'),
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/),
  }),
  z.object({ type: z.literal('monthly'), day: z.number().int().min(1).max(31), time: TIME }),
  z.object({ type: z.literal('startup'), delayMinutes: z.number().int().min(0).max(120) }),
]);
export type Schedule = z.infer<typeof ScheduleSchema>;
/** What forms send (a daily schedule may leave out its days). */
export type ScheduleInput = z.input<typeof ScheduleSchema>;
