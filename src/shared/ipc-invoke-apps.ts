import { z } from 'zod';
import { PasswordEntryInput } from './passwords';
import { BrainRefSchema } from './llm-providers';
import { NPC_STATES, NpcInputSchema, NpcMeetingSchema, NpcMessageSchema, NpcSchema } from './npcs';
import {
  CalendarId,
  CalendarSchema,
  EventId,
  EventPatchSchema,
  EventSchema,
  ListId,
  LocalDate,
  TodoId,
  TodoListSchema,
  TodoPatchSchema,
  TodoSchema,
} from './planner';
import {
  Empty,
  MasterPassword,
  NpcChannel,
  NpcId,
  Ok,
  PasswordEntry,
  PasswordId,
  PasswordSummary,
  RemoteStatus,
  SpaceIcon,
  SpaceNameInput,
  WhatsAppStatus,
  contract,
} from './ipc-schemas';

/** Logs, Brain, Tasks and Calendar, Spaces, Passwords, clipboard, timeline, undo and NPCs. Part of INVOKE (ipc-contract.ts puts the parts together and checks none is missing). */
export const INVOKE_APPS = {
  /** isair/jarvis-style Logs view: newest lines of the (already redacted) log. */
  'logs:tail': contract(
    z.object({ lines: z.number().int().min(10).max(1000) }),
    z.array(
      z.object({ time: z.string(), level: z.string(), module: z.string(), text: z.string() }),
    ),
  ),
  'app:openFolder': contract(
    z.object({ which: z.enum(['userData', 'logs', 'vault', 'backups']) }),
    Ok,
  ),
  // Spaces (Notion-style notebooks in the vault).
  'spaces:list': contract(
    Empty,
    z.array(
      z.object({
        name: z.string(),
        icon: z.string(),
        pageCount: z.number(),
        updatedAt: z.string().nullable(),
      }),
    ),
  ),
  'spaces:create': contract(z.object({ name: SpaceNameInput, icon: SpaceIcon }), Ok),
  'spaces:update': contract(
    z.object({
      name: SpaceNameInput,
      next: z.object({ name: SpaceNameInput.optional(), icon: SpaceIcon.optional() }),
    }),
    Ok,
  ),
  'spaces:delete': contract(z.object({ name: SpaceNameInput }), Ok),
  'spaces:pages': contract(
    z.object({ space: SpaceNameInput }),
    z.array(
      z.object({
        name: z.string(),
        updatedAt: z.string(),
        size: z.number(),
        excerpt: z.string(),
        icon: z.string().optional(),
        cover: z.string().optional(),
      }),
    ),
  ),
  'spaces:read': contract(
    z.object({ space: SpaceNameInput, page: SpaceNameInput }),
    z.object({ markdown: z.string(), hash: z.string() }),
  ),
  'spaces:write': contract(
    z.object({
      space: SpaceNameInput,
      page: SpaceNameInput,
      markdown: z.string().max(1_000_000),
      expectedHash: z.string().max(100).optional(),
    }),
    z.object({ markdown: z.string(), hash: z.string() }),
  ),
  'spaces:createPage': contract(
    z.object({
      space: SpaceNameInput,
      title: SpaceNameInput,
      template: z.enum(['blank', 'journal', 'learning', 'meeting', 'finance', 'project']),
    }),
    z.object({ name: z.string() }),
  ),
  'spaces:renamePage': contract(
    z.object({ space: SpaceNameInput, page: SpaceNameInput, next: SpaceNameInput }),
    Ok,
  ),
  'spaces:deletePage': contract(z.object({ space: SpaceNameInput, page: SpaceNameInput }), Ok),
  'spaces:open': contract(z.object({ space: SpaceNameInput, page: SpaceNameInput.optional() }), Ok),
  /** Brain view: every note as a dot, [[links]] and folders as connections. */
  'memory:graph': contract(
    Empty,
    z.object({
      nodes: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          group: z.string(),
          size: z.number(),
          updatedAt: z.string(),
        }),
      ),
      links: z.array(
        z.object({ source: z.string(), target: z.string(), kind: z.enum(['link', 'folder']) }),
      ),
    }),
  ),
  'remote:status': contract(Empty, RemoteStatus),
  'remote:pair': contract(Empty, RemoteStatus),
  'remote:revoke': contract(z.object({ id: z.string().regex(/^[0-9a-f]{12}$/) }), Ok),
  'remote:restart': contract(Empty, RemoteStatus),
  'whatsapp:status': contract(Empty, WhatsAppStatus),
  'whatsapp:restart': contract(Empty, WhatsAppStatus),
  'whatsapp:logout': contract(Empty, Ok),
  // Tasks and Calendar (PRD F25/F26): the views load everything at once and refresh on planner:changed.
  'planner:state': contract(
    Empty,
    z.object({
      lists: z.array(TodoListSchema),
      todos: z.array(TodoSchema),
      calendars: z.array(CalendarSchema),
      events: z.array(EventSchema),
    }),
  ),
  'todos:save': contract(TodoPatchSchema, TodoSchema),
  'todos:delete': contract(z.object({ id: TodoId }), Ok),
  'todos:clearCompleted': contract(Empty, z.object({ count: z.number() })),
  'todos:saveList': contract(
    z.object({
      id: ListId.optional(),
      /** Required when creating; a patch may leave it out. */
      name: z.string().trim().min(1).max(60).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      icon: z.string().max(16).optional(),
      sortOrder: z.number().finite().optional(),
      description: z.string().max(500).optional(),
      wipLimit: z.number().int().min(1).max(50).nullable().optional(),
      archived: z.boolean().optional(),
    }),
    TodoListSchema,
  ),
  'todos:deleteList': contract(z.object({ id: ListId }), Ok),
  'calendar:save': contract(EventPatchSchema, EventSchema),
  'calendar:delete': contract(
    z.object({
      id: EventId,
      date: LocalDate.optional(),
      scope: z.enum(['one', 'following', 'all']).optional(),
    }),
    Ok,
  ),
  'calendar:saveCalendar': contract(
    z.object({
      id: CalendarId.optional(),
      name: z.string().trim().min(1).max(60).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      visible: z.boolean().optional(),
    }),
    CalendarSchema,
  ),
  'calendar:deleteCalendar': contract(z.object({ id: CalendarId }), Ok),
  /** Opens a file picker in main; null when Sir cancels. */
  'calendar:importIcs': contract(
    Empty,
    z.object({ name: z.string(), count: z.number(), skipped: z.number() }).nullable(),
  ),
  'calendar:exportIcs': contract(
    z.object({ calendarId: CalendarId.optional() }),
    z.object({ path: z.string().nullable() }),
  ),
  // Mini orb (Design-system.md §4.3): drag, snap to a screen edge, tuck away, caption bubble.
  'mini:dragStart': contract(Empty, Ok),
  'mini:dragEnd': contract(Empty, z.object({ moved: z.boolean() })),
  'mini:tuck': contract(z.object({ tucked: z.boolean() }), Ok),
  'mini:menu': contract(Empty, Ok),
  'mini:caption': contract(z.object({ open: z.boolean() }), Ok),
  // Password manager (Security.md §16.6): only the Passwords view uses these; no tool can.
  'passwords:status': contract(
    Empty,
    z.object({ exists: z.boolean(), unlocked: z.boolean(), count: z.number() }),
  ),
  'passwords:setup': contract(z.object({ master: MasterPassword }), Ok),
  'passwords:unlock': contract(z.object({ master: MasterPassword }), Ok),
  'passwords:lock': contract(Empty, Ok),
  'passwords:list': contract(Empty, z.array(PasswordSummary)),
  'passwords:get': contract(z.object({ id: PasswordId }), PasswordEntry),
  'passwords:save': contract(PasswordEntryInput, PasswordSummary),
  'passwords:delete': contract(z.object({ id: PasswordId }), Ok),
  'passwords:copy': contract(
    z.object({ id: PasswordId, field: z.enum(['username', 'password', 'totp']) }),
    z.object({ clearsInSeconds: z.number() }),
  ),
  'passwords:totp': contract(
    z.object({ id: PasswordId }),
    z.object({ code: z.string(), secondsLeft: z.number() }),
  ),
  'passwords:changeMaster': contract(
    z.object({ current: MasterPassword, next: MasterPassword }),
    Ok,
  ),
  /** Clipboard history (2.65): previews for the command palette; restore copies one back. */
  'clipboard:history': contract(
    Empty,
    z.array(z.object({ id: z.number().int(), preview: z.string(), at: z.number() })),
  ),
  'clipboard:restore': contract(z.object({ id: z.number().int().min(1) }), Ok),
  'clipboard:clear': contract(Empty, Ok),
  /** Day timeline (2.66): time per app for one local day (default today). */
  'timeline:day': contract(
    z.object({
      day: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
    z.object({
      day: z.string(),
      totalSeconds: z.number(),
      apps: z.array(
        z.object({
          process: z.string(),
          seconds: z.number(),
          windows: z.array(z.object({ title: z.string(), seconds: z.number() })),
        }),
      ),
    }),
  ),
  'timeline:clear': contract(Empty, Ok),
  /** Screen memory (2.72): snippets for the command palette; copy puts one capture's text on the clipboard. */
  'screen:search': contract(
    z.object({ query: z.string().trim().min(2).max(100) }),
    z.array(
      z.object({
        id: z.number().int(),
        at: z.string(),
        process: z.string(),
        title: z.string(),
        snippet: z.string(),
      }),
    ),
  ),
  'screen:copy': contract(z.object({ id: z.number().int().min(1) }), Ok),
  'screen:clear': contract(Empty, Ok),
  /** Undo (2.70): the last thing Jarvis changed, and taking it back (the UI confirms first). */
  'undo:peek': contract(
    Empty,
    z.object({ id: z.number().int(), label: z.string(), at: z.number() }).nullable(),
  ),
  'undo:run': contract(
    z.object({ id: z.number().int().min(1) }),
    z.object({ ok: z.boolean(), message: z.string() }),
  ),
  /** NPCs (2.21): Sir's team of single-purpose agents, Jarvis at their head. */
  'npcs:list': contract(
    Empty,
    z.object({
      npcs: z.array(NpcSchema),
      states: z.record(z.string(), z.enum(NPC_STATES)),
      /** Brains set up right now (the editor offers only these). */
      brains: z.array(BrainRefSchema),
      /** Names for Sir's extra connections (conn_...), which the brain list doesn't know. */
      brainLabels: z.record(z.string(), z.string()),
      /** Jarvis's tools an NPC may be given (his policy still applies to every call). */
      tools: z.array(z.object({ name: z.string(), description: z.string() })),
    }),
  ),
  'npcs:create': contract(NpcInputSchema, NpcSchema),
  'npcs:update': contract(z.object({ id: NpcId, input: NpcInputSchema }), NpcSchema),
  'npcs:delete': contract(z.object({ id: NpcId }), Ok),
  'npcs:messages': contract(z.object({ channel: NpcChannel }), z.array(NpcMessageSchema)),
  /** Sir writes in a channel; replies arrive as npc:message events. */
  'npcs:send': contract(z.object({ channel: NpcChannel, text: z.string().min(1).max(8000) }), Ok),
  'npcs:clear': contract(z.object({ channel: NpcChannel }), Ok),
  'npcs:memory': contract(
    z.object({ id: NpcId }),
    z.object({ path: z.string(), markdown: z.string() }),
  ),
  'npcs:meetings': contract(Empty, z.array(NpcMeetingSchema)),
  'npcs:startMeeting': contract(
    z.object({
      topic: z.string().min(3).max(300),
      attendees: z.array(NpcId).min(1).max(6),
      rounds: z.number().int().min(1).max(3),
    }),
    NpcMeetingSchema,
  ),
  'npcs:stopMeeting': contract(z.object({ id: z.string().regex(/^mtg_[\w-]{1,40}$/) }), Ok),
};
