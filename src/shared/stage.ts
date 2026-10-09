import { z } from 'zod';

/**
 * Core stage panels (Design-system.md §5.2a): Jarvis moves aside and shows one panel beside the
 * orb. Built-in kinds read live app data; the generic kinds carry Jarvis's own content, so a new
 * feature (tasks, calendar…) can show itself today as a `list` and get a dedicated kind later.
 */
const Title = z.string().trim().min(1).max(80);

export const StagePanelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pomodoro'),
    /** Focus minutes (default 25) and the short break after it (default 5). */
    minutes: z.number().int().min(1).max(180).default(25),
    breakMinutes: z.number().int().min(0).max(60).default(5),
    label: z.string().trim().max(80).optional(),
  }),
  /** AI provider usage and billing: spend against the budgets, by model / purpose / day. */
  z.object({ kind: z.literal('usage') }),
  /** Jarvis's own dashboard: connection, voice, budgets, connections, spaces, memory. */
  z.object({ kind: z.literal('status') }),
  z.object({
    kind: z.literal('list'),
    title: Title,
    items: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(200),
          detail: z.string().trim().max(200).optional(),
          done: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(40),
  }),
  z.object({
    kind: z.literal('stats'),
    title: Title,
    stats: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(40),
          value: z.string().trim().min(1).max(40),
          hint: z.string().trim().max(80).optional(),
          /** 0–100: drawn as a bar under the value. */
          percent: z.number().min(0).max(100).optional(),
        }),
      )
      .min(1)
      .max(12),
  }),
  z.object({ kind: z.literal('note'), title: Title, markdown: z.string().max(8000) }),
]);
export type StagePanel = z.infer<typeof StagePanelSchema>;
export type StagePanelInput = z.input<typeof StagePanelSchema>;
export const STAGE_PANEL_KINDS = StagePanelSchema.options.map((o) => o.shape.kind.value);
