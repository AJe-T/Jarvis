import type { Schedule } from './schedule';

/** Ready-made automations (Automations → Templates): Sir picks one, adjusts it and saves. */
export interface AutomationTemplate {
  id: string;
  name: string;
  blurb: string;
  kind: 'briefing' | 'task' | 'checkin';
  prompt: string;
  schedule: Schedule;
  speak: boolean;
  saveToVault: boolean;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'evening',
    name: 'Evening wrap-up',
    blurb: 'Your day in review and tomorrow at a glance.',
    kind: 'briefing',
    schedule: { type: 'daily', time: '21:00', days: [] },
    speak: true,
    saveToVault: true,
    prompt:
      "Wrap up Sir's day: what we talked about and did today (search_conversations for today), tasks he finished and those still open (tasks), and tomorrow's calendar (calendar). End with the one thing to start with tomorrow. Keep the spoken part under 40 seconds.",
  },
  {
    id: 'weekly',
    name: 'Weekly review',
    blurb: 'Fridays at 5 pm: done, slipped and next week.',
    kind: 'briefing',
    schedule: { type: 'daily', time: '17:00', days: [5] },
    speak: false,
    saveToVault: true,
    prompt:
      "Write Sir's weekly review: what got done this week (completed tasks, conversations), what slipped (overdue tasks), next week's calendar, and three priorities for next week.",
  },
  {
    id: 'startup',
    name: 'When I start Jarvis',
    blurb: 'Each start: only what needs you right now.',
    kind: 'checkin',
    schedule: { type: 'startup', delayMinutes: 0 },
    speak: true,
    saveToVault: false,
    prompt:
      'Sir just started Jarvis. If there are overdue tasks, events in the next two hours or reminders due today, tell him in one or two sentences. Otherwise reply NOTHING.',
  },
  {
    id: 'focus',
    name: 'Late-morning focus nudge',
    blurb: 'Weekdays at 11: a nudge if today’s tasks are untouched.',
    kind: 'checkin',
    schedule: { type: 'daily', time: '11:00', days: [1, 2, 3, 4, 5] },
    speak: true,
    saveToVault: false,
    prompt:
      "Check Sir's tasks due today (tasks). If one is still To do, nudge him about the most important one in one sentence. Otherwise reply NOTHING.",
  },
  {
    id: 'goals',
    name: 'Goal check',
    blurb: 'Sundays at 6 pm: goals that are falling behind.',
    kind: 'checkin',
    schedule: { type: 'daily', time: '18:00', days: [0] },
    speak: true,
    saveToVault: false,
    prompt:
      "Look at Sir's goals (goals, action list). For each goal that is behind or overdue, say it in one sentence with the next milestone to do. If every goal is on track (or there are none), reply NOTHING.",
  },
  {
    id: 'bills',
    name: 'Monthly bills check',
    blurb: 'On the 1st: bills, renewals and subscriptions due.',
    kind: 'task',
    schedule: { type: 'monthly', day: 1, time: '10:00' },
    speak: false,
    saveToVault: true,
    prompt:
      "It's the start of the month. From memory and Sir's tasks, list the bills, subscriptions and payments due this month with dates and amounts where known. Offer to add a task for any that has none.",
  },
  {
    id: 'news',
    name: 'Lunchtime news',
    blurb: 'The five headlines that matter, at 1 pm.',
    kind: 'briefing',
    schedule: { type: 'daily', time: '13:00', days: [] },
    speak: false,
    saveToVault: false,
    prompt:
      "Read the top headlines from Sir's news feeds (read_feed) and give him the five that matter most, one line each with its link.",
  },
  {
    id: 'stretch',
    name: 'Stretch and water break',
    blurb: 'Every 90 minutes, a short spoken nudge.',
    kind: 'task',
    schedule: { type: 'interval', minutes: 90 },
    speak: true,
    saveToVault: false,
    prompt:
      'Remind Sir in one short sentence, worded differently each time, to stand up, stretch and drink some water. Use no tools.',
  },
  {
    id: 'claude-watch',
    name: 'Claude Code watch',
    blurb: 'Every 30 minutes: any Claude Code session stuck on you.',
    kind: 'checkin',
    schedule: { type: 'interval', minutes: 30 },
    speak: true,
    saveToVault: false,
    prompt:
      'Check claude_sessions for sessions waiting on Sir. If any are, say which project and what it wants in one sentence. Otherwise reply NOTHING.',
  },
];
