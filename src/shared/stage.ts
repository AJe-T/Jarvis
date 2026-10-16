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
  /** Live PC monitor: CPU, memory, disk, battery and uptime, refreshed every two seconds. */
  z.object({ kind: z.literal('system') }),
  /** A QR code drawn on this PC (nothing is sent anywhere): a link, Wi-Fi login, contact, any text. */
  z.object({
    kind: z.literal('qr'),
    title: Title,
    text: z.string().min(1).max(1200),
  }),
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
  z.object({ kind: z.literal('note'), title: Title, markdown: z.string().max(50_000) }),
  // Apps on Core's header (§5.2a): tools that run on this PC, nothing is sent anywhere.
  /** Today's tasks (and overdue ones) and events, from Tasks and Calendar. */
  z.object({ kind: z.literal('today') }),
  /** expression: a sum to show already worked out ("2+2", "15% * 2400"). */
  z.object({
    kind: z.literal('calculator'),
    expression: z.string().trim().max(200).optional(),
  }),
  /** Length, weight, temperature, volume, speed, area, time and data units. */
  z.object({ kind: z.literal('converter') }),
  /** Local time and the time in other cities. */
  z.object({ kind: z.literal('clock') }),
  /** Countdowns that survive restarts, reminders and a stopwatch (Apps → Timers). */
  z.object({ kind: z.literal('timers') }),
  /** Notes Sir and Jarvis share (Apps → Scratchpad). */
  z.object({ kind: z.literal('scratchpad') }),
  /**
   * Jarvis Browser, Terminal and Camera: their own isolated pages (ADR-032/040), placed by main over
   * this panel's area. Nothing of theirs runs in the app's renderer.
   */
  z.object({ kind: z.literal('browser') }),
  z.object({ kind: z.literal('terminal') }),
  z.object({ kind: z.literal('camera') }),
  /** A page, drawing or diagram from a reply, run in the network-less artifact sandbox. */
  z.object({
    kind: z.literal('artifact'),
    title: Title,
    format: z.enum(['html', 'svg', 'mermaid']),
    code: z.string().min(1).max(200_000),
  }),
  /** A picture (a file Jarvis made or Sir asked to see), as a data URL; at most ~8 MB. */
  z.object({
    kind: z.literal('image'),
    title: Title,
    src: z
      .string()
      .max(12_000_000)
      .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/),
  }),
]);
export type StagePanel = z.infer<typeof StagePanelSchema>;
export type StagePanelInput = z.input<typeof StagePanelSchema>;
export const STAGE_PANEL_KINDS = StagePanelSchema.options.map((o) => o.shape.kind.value);
