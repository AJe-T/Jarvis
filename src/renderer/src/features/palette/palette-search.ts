import type { View } from '../../stores/ui-store';

/** Order the groups are shown in. Passwords are never searched: only the Passwords screen is listed. */
export const PALETTE_GROUPS = [
  'Actions',
  'Go to',
  'Settings',
  'Tasks',
  'Calendar',
  'Spaces',
  'Chats',
  'Memory',
] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** What choosing a result does. Data, not a callback, so the search stays a pure function. */
export type PaletteRun =
  | { kind: 'view'; view: View; section?: string }
  | { kind: 'chat'; id: string }
  | { kind: 'todo'; id: string }
  | { kind: 'newChat' }
  | { kind: 'toggleSidebar' };

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  /** Extra words that match but are not shown. */
  keywords?: string;
  run: PaletteRun;
}

export interface PaletteSources {
  views: Array<{ view: View; label: string }>;
  settings: Array<{ id: string; label: string; keywords: string }>;
  todos: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  events: Array<{ id: string; title: string; start: string }>;
  spaces: Array<{ name: string; pages: string[] }>;
  chats: Array<{ id: string; title: string | null }>;
}

const PER_GROUP = 6;

/** Everything the palette can find without asking the main process. */
export function localItems(s: PaletteSources): PaletteItem[] {
  return [
    {
      id: 'action:new-chat',
      group: 'Actions',
      label: 'New chat',
      keywords: 'conversation start',
      run: { kind: 'newChat' },
    },
    {
      id: 'action:sidebar',
      group: 'Actions',
      label: 'Show or hide the sidebar',
      keywords: 'rail menu',
      run: { kind: 'toggleSidebar' },
    },
    ...s.views.map((v): PaletteItem => ({
      id: `view:${v.view}`,
      group: 'Go to',
      label: v.label,
      run: { kind: 'view', view: v.view },
    })),
    ...s.settings.map((x): PaletteItem => ({
      id: `settings:${x.id}`,
      group: 'Settings',
      label: x.label,
      keywords: x.keywords,
      run: { kind: 'view', view: 'settings', section: x.id },
    })),
    ...s.todos
      .filter((t) => t.status !== 'done')
      .map((t): PaletteItem => ({
        id: `todo:${t.id}`,
        group: 'Tasks',
        label: t.title,
        ...(t.dueDate ? { hint: `due ${t.dueDate}` } : {}),
        run: { kind: 'todo', id: t.id },
      })),
    ...s.events.map((e): PaletteItem => ({
      id: `event:${e.id}`,
      group: 'Calendar',
      label: e.title,
      hint: e.start.replace('T', ' '),
      run: { kind: 'view', view: 'calendar' },
    })),
    ...s.spaces.flatMap((space): PaletteItem[] => [
      {
        id: `space:${space.name}`,
        group: 'Spaces',
        label: space.name,
        run: { kind: 'view', view: 'spaces', section: space.name },
      },
      ...space.pages.map((page): PaletteItem => ({
        id: `space:${space.name}/${page}`,
        group: 'Spaces',
        label: page,
        hint: space.name,
        run: { kind: 'view', view: 'spaces', section: `${space.name}/${page}` },
      })),
    ]),
    ...s.chats.map((c): PaletteItem => ({
      id: `chat:${c.id}`,
      group: 'Chats',
      label: c.title ?? 'Untitled chat',
      run: { kind: 'chat', id: c.id },
    })),
  ];
}

/**
 * Items where every word of the query appears, labels that start with the query first, at most
 * six per group. With no query: the actions and screens only, so the palette opens as a menu.
 */
export function matchItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((i) => i.group === 'Actions' || i.group === 'Go to');
  const words = q.split(/\s+/);
  const hits = items.filter((i) => {
    const hay = `${i.label} ${i.hint ?? ''} ${i.keywords ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return groupItems(hits, q);
}

/** Group order, best label match first inside a group, capped per group, no id twice. */
export function groupItems(items: PaletteItem[], query = ''): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const unique = items.filter((i) => !seen.has(i.id) && seen.add(i.id));
  const starts = (i: PaletteItem): number => (q && i.label.toLowerCase().startsWith(q) ? 0 : 1);
  return PALETTE_GROUPS.flatMap((g) =>
    unique
      .filter((i) => i.group === g)
      .sort((a, b) => starts(a) - starts(b))
      .slice(0, PER_GROUP),
  );
}
