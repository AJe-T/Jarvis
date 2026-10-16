import type { StagePanel } from './stage';

/**
 * Every Jarvis app (ADR-032/040), in one list: Sidebar → Apps, Core's "All apps" and the
 * open_jarvis_app tool all read it, and each app opens as a panel beside the orb. A new app is one
 * entry here (plus its panel kind in stage.ts and an icon in the renderer).
 */
export const JARVIS_APPS = [
  'today',
  'calculator',
  'browser',
  'terminal',
  'camera',
  'timers',
  'pomodoro',
  'scratchpad',
  'converter',
  'clock',
  'qr',
  'monitor',
  'usage',
  'status',
] as const;
export type JarvisAppId = (typeof JARVIS_APPS)[number];

export interface JarvisAppInfo {
  label: string;
  /** One line under the name. */
  blurb: string;
  panel: StagePanel;
  /** Turns on a camera or microphone: Jarvis asks before opening it. */
  sensitive?: boolean;
}

export const JARVIS_APP_INFO: Record<JarvisAppId, JarvisAppInfo> = {
  today: { label: 'Today', blurb: 'Your tasks and events for today.', panel: { kind: 'today' } },
  calculator: {
    label: 'Calculator',
    blurb: 'Type or tap; percentages, powers and brackets.',
    panel: { kind: 'calculator' },
  },
  browser: {
    label: 'Browser',
    blurb: 'Jarvis’s own browser, kept apart from the app. Jarvis can open pages and read them.',
    panel: { kind: 'browser' },
  },
  terminal: {
    label: 'Terminal',
    blurb: 'A PowerShell console. Shows every script Jarvis runs for you.',
    panel: { kind: 'terminal' },
  },
  camera: {
    label: 'Camera',
    blurb: 'See yourself and take photos (saved to Pictures). Off when you close it.',
    panel: { kind: 'camera' },
    sensitive: true,
  },
  timers: {
    label: 'Timers',
    blurb: 'Countdowns, reminders and a stopwatch, live.',
    panel: { kind: 'timers' },
  },
  pomodoro: {
    label: 'Pomodoro',
    blurb: '25-minute focus blocks with breaks.',
    panel: { kind: 'pomodoro', minutes: 25, breakMinutes: 5 },
  },
  scratchpad: {
    label: 'Scratchpad',
    blurb: 'Quick notes you and Jarvis share.',
    panel: { kind: 'scratchpad' },
  },
  converter: {
    label: 'Unit converter',
    blurb: 'Length, weight, temperature, data and more.',
    panel: { kind: 'converter' },
  },
  clock: {
    label: 'World clock',
    blurb: 'The time here and in other cities.',
    panel: { kind: 'clock' },
  },
  qr: {
    label: 'QR code',
    blurb: 'Turn a link or any text into a QR code.',
    panel: { kind: 'qr', title: 'QR code', text: '' },
  },
  monitor: {
    label: 'System monitor',
    blurb: 'CPU, memory, disk, battery and uptime, every two seconds.',
    panel: { kind: 'system' },
  },
  usage: { label: 'AI usage', blurb: 'Spend against your budgets.', panel: { kind: 'usage' } },
  status: {
    label: 'Jarvis status',
    blurb: 'Connection, voice, budgets and connections.',
    panel: { kind: 'status' },
  },
};

/** Panels that are an app's isolated page placed over the stage by main (not drawn by the renderer). */
export const DOCKED_KINDS = ['browser', 'terminal', 'camera'] as const;
export type DockedKind = (typeof DOCKED_KINDS)[number];
export const isDockedKind = (kind: string): kind is DockedKind =>
  (DOCKED_KINDS as readonly string[]).includes(kind);
