import { z } from 'zod';
import { BRAIN_IDS } from './llm-providers';

/**
 * NPCs (2.21): Sir's team of single-purpose agents, each with its own brief, AI, tools and memory.
 * Jarvis is their head. Ideas from Agents Office (departments, leads, briefs, teammates leaving
 * @notes for each other) and Claw3D (agents as workers in an office, standups); our own code.
 */

export const NPC_COLORS = [
  'cyan',
  'violet',
  'amber',
  'emerald',
  'rose',
  'sky',
  'lime',
  'orange',
  'fuchsia',
  'teal',
] as const;
export type NpcColor = (typeof NPC_COLORS)[number];

/** Also a vault folder name: no trailing dot or space (Windows drops them, two names would share one). */
export const NPC_NAME_RE = /^[A-Za-z](?:[A-Za-z0-9 ._-]{0,22}[A-Za-z0-9])?$/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export const NpcInputSchema = z.object({
  name: z
    .string()
    .regex(NPC_NAME_RE, 'Letters, numbers, spaces, . _ - (max 24), starting with a letter')
    .refine((n) => !RESERVED.test(n), 'That name is reserved by Windows'),
  role: z.string().min(2).max(60),
  emoji: z.string().min(1).max(8),
  color: z.enum(NPC_COLORS),
  brain: z.enum(BRAIN_IDS),
  instructions: z.string().min(10).max(4000),
  tools: z.array(z.string().min(2).max(80)).max(30),
  enabled: z.boolean(),
  templateId: z.string().max(40).nullable(),
});
export type NpcInput = z.infer<typeof NpcInputSchema>;

export const NpcSchema = NpcInputSchema.extend({
  id: z.string(),
  desk: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Npc = z.infer<typeof NpcSchema>;

export const NpcMessageSchema = z.object({
  id: z.string(),
  channel: z.string(),
  /** 'sir', 'jarvis' or an NPC id. */
  author: z.string(),
  text: z.string(),
  mentions: z.array(z.string()),
  /** Written after reading outside content (a web page, a file): treated as data, never orders. */
  tainted: z.boolean(),
  createdAt: z.string(),
});
export type NpcMessage = z.infer<typeof NpcMessageSchema>;

export const NpcMeetingSchema = z.object({
  id: z.string(),
  topic: z.string(),
  attendees: z.array(z.string()),
  status: z.enum(['running', 'done', 'stopped']),
  summary: z.string(),
  createdAt: z.string(),
});
export type NpcMeeting = z.infer<typeof NpcMeetingSchema>;

/** What an NPC is doing right now (drives the office animation). */
export const NPC_STATES = ['idle', 'working', 'meeting', 'off'] as const;
export type NpcState = (typeof NPC_STATES)[number];

export const OFFICE = 'office';
export const dmChannel = (npcId: string): string => `dm:${npcId}`;
export const meetingChannel = (meetingId: string): string => `meeting:${meetingId}`;

/**
 * @tags in a message → ids of the NPCs (and 'jarvis') it addresses. Names match case-insensitively,
 * with or without spaces ("@Ledger", "@market head" → "Market Head" needs "@MarketHead" or the
 * exact name); "@all" / "@everyone" tag every NPC given.
 */
export function parseMentions(
  text: string,
  npcs: ReadonlyArray<Pick<Npc, 'id' | 'name'>>,
  assistantName = 'Jarvis',
): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  const byName = [...npcs].sort((a, b) => b.name.length - a.name.length);
  // Not after a letter or digit, so an email address is not a tag.
  for (const m of lower.matchAll(/(?:^|[^\w])@([a-z0-9][\w .-]*)/g)) {
    const tail = m[1] ?? '';
    if (/^(all|everyone|team)\b/.test(tail)) for (const n of npcs) out.add(n.id);
    if (startsWithWord(tail, assistantName.toLowerCase()) || startsWithWord(tail, 'jarvis'))
      out.add('jarvis');
    const hit = byName.find(
      (n) =>
        startsWithWord(tail, n.name.toLowerCase()) ||
        startsWithWord(tail, n.name.toLowerCase().replace(/\s+/g, '')),
    );
    if (hit) out.add(hit.id);
  }
  return [...out];
}

/** "maya, can you…" starts with "maya"; "mayank" does not. */
function startsWithWord(text: string, word: string): boolean {
  return text.startsWith(word) && !/[a-z0-9]/.test(text.charAt(word.length));
}

export interface NpcTemplate {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: NpcColor;
  blurb: string;
  instructions: string;
  tools: string[];
}

/** Ready-made NPCs: pick one, rename it, change anything. Tools are Jarvis's; his policy still applies. */
export const NPC_TEMPLATES: readonly NpcTemplate[] = [
  {
    id: 'marketing',
    name: 'Maya',
    role: 'Marketing Head',
    emoji: '📣',
    color: 'rose',
    blurb: 'Campaigns, posts, positioning and launch plans.',
    instructions:
      'You run marketing. Turn goals into campaigns, posts, taglines and launch plans. Know the audience first; give concrete copy, channels, timing and a way to measure results. Check facts about competitors before you state them.',
    tools: ['deep_research', 'fetch_web_page', 'read_feed', 'write_text_file'],
  },
  {
    id: 'finance',
    name: 'Ledger',
    role: 'Finance Manager',
    emoji: '💰',
    color: 'emerald',
    blurb: 'Budgets, costs, prices, invoices and forecasts.',
    instructions:
      'You handle money: budgets, costs, pricing, cash flow, invoices and simple forecasts. Show your numbers and assumptions in a small table. Flag risks plainly. Never move money or pay anything; you advise.',
    tools: ['get_market_price', 'convert_currency', 'read_document', 'write_text_file'],
  },
  {
    id: 'frontend',
    name: 'Pixel',
    role: 'Frontend Developer',
    emoji: '🎨',
    color: 'sky',
    blurb: 'React, CSS, UI bugs and component design.',
    instructions:
      'You are a senior frontend developer (React, TypeScript, CSS, accessibility). Read the code before suggesting changes, give exact file and line references, and keep fixes small. Explain trade-offs in one or two lines.',
    tools: ['read_text_file', 'search_files', 'fetch_web_page', 'write_text_file'],
  },
  {
    id: 'backend',
    name: 'Forge',
    role: 'Backend Developer',
    emoji: '🛠️',
    color: 'orange',
    blurb: 'APIs, databases, servers and debugging.',
    instructions:
      'You are a senior backend developer (Node.js, Python, SQL, APIs). Find root causes, not symptoms. Read the code first, cite files and lines, propose the smallest correct fix and how to test it. Security first.',
    tools: ['read_text_file', 'search_files', 'fetch_web_page', 'write_text_file'],
  },
  {
    id: 'research',
    name: 'Scout',
    role: 'Researcher',
    emoji: '🔎',
    color: 'violet',
    blurb: 'Deep research with sources.',
    instructions:
      'You research. Search widely, read the sources, compare them and report what is known, what is disputed and what is unknown, each with its source link. Keep it short; put details in a list.',
    tools: ['deep_research', 'fetch_web_page', 'wikipedia', 'read_feed', 'read_document'],
  },
  {
    id: 'writer',
    name: 'Quill',
    role: 'Content Writer',
    emoji: '✍️',
    color: 'amber',
    blurb: 'Blogs, emails, scripts and editing.',
    instructions:
      "You write and edit: blog posts, emails, scripts, captions. Match the tone asked for, keep sentences short and concrete, and offer a headline or subject line. When editing, keep the author's voice.",
    tools: ['fetch_web_page', 'wikipedia', 'define_word', 'write_text_file'],
  },
  {
    id: 'sales',
    name: 'Closer',
    role: 'Sales Lead',
    emoji: '🤝',
    color: 'lime',
    blurb: 'Leads, pitches, follow-ups and objections.',
    instructions:
      'You run sales. Research prospects, write short personalised outreach and follow-ups, prepare answers to objections and suggest next steps. Never send anything yourself; draft it for Sir.',
    tools: ['deep_research', 'fetch_web_page', 'write_text_file'],
  },
  {
    id: 'pm',
    name: 'Atlas',
    role: 'Project Manager',
    emoji: '🗂️',
    color: 'teal',
    blurb: 'Plans, tasks, deadlines and status reports.',
    instructions:
      "You manage projects. Break goals into tasks with owners and dates, track what is late, and write short status reports. Use Sir's task list and calendar; ask before deleting anything.",
    tools: ['tasks', 'calendar', 'goals', 'set_reminder'],
  },
  {
    id: 'designer',
    name: 'Muse',
    role: 'Designer',
    emoji: '🖌️',
    color: 'fuchsia',
    blurb: 'UI/UX ideas, layouts, colours and critiques.',
    instructions:
      'You are a product designer. Give layout, colour and typography ideas with reasons, critique designs against usability and accessibility, and describe screens precisely enough to build.',
    tools: ['fetch_web_page', 'write_text_file'],
  },
  {
    id: 'coach',
    name: 'Vigor',
    role: 'Fitness & Diet Coach',
    emoji: '🏋️',
    color: 'cyan',
    blurb: 'Workouts, meals and habits.',
    instructions:
      "You coach fitness and nutrition. Give simple, safe plans that fit Sir's day, track meals he logs, and encourage without nagging. Not a doctor: suggest one for pain, injury or medical questions.",
    tools: ['log_meal', 'list_meals', 'set_reminder'],
  },
];
