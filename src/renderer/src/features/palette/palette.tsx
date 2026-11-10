import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { NAV_ITEMS } from '../../components/jarvis/rail';
import { call } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';
import { usePlannerStore } from '../../stores/planner-store';
import { useSetting } from '../../stores/settings-store';
import { useSpacesStore } from '../../stores/spaces-store';
import { useUiStore } from '../../stores/ui-store';
import { SETTINGS_SECTIONS } from '../settings/sections';
import {
  groupItems,
  localItems,
  matchItems,
  type PaletteItem,
  type PaletteRun,
} from './palette-search';

const DEBOUNCE_MS = 200;
const MIN_REMOTE_QUERY = 2;

function run(r: PaletteRun): void {
  const ui = useUiStore.getState();
  switch (r.kind) {
    case 'view':
      return ui.go(r.view, r.section);
    case 'chat':
      ui.go('chat');
      return void useChatStore.getState().open(r.id);
    case 'todo':
      usePlannerStore.getState().setFocusTodo(r.id);
      return ui.go('tasks');
    case 'newChat':
      useChatStore.getState().newConversation();
      return ui.go('chat');
    case 'toggleSidebar':
      return ui.toggleRail();
  }
}

/** What past chats and memory notes say (searched in the main process), as Sir types. */
function useRemoteHits(query: string): PaletteItem[] {
  const [hits, setHits] = useState<PaletteItem[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_REMOTE_QUERY) return setHits([]);
    let live = true;
    const t = setTimeout(() => {
      void Promise.allSettled([
        call('conversations:search', { query: q }),
        call('memory:search', { query: q }),
      ]).then(([chats, notes]) => {
        if (!live) return;
        setHits([
          ...(chats.status === 'fulfilled' ? chats.value : []).map((h): PaletteItem => ({
            id: `chat:${h.conversationId}`,
            group: 'Chats',
            label: h.title ?? 'Untitled chat',
            hint: h.snippet.replace(/[[\]]/g, ''),
            run: { kind: 'chat', id: h.conversationId },
          })),
          ...(notes.status === 'fulfilled' ? notes.value : []).map((h): PaletteItem => ({
            id: `memory:${h.vaultPath}`,
            group: 'Memory',
            label: h.title,
            hint: h.snippet,
            run: { kind: 'view', view: 'memory', section: h.vaultPath },
          })),
        ]);
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  return hits;
}

/** Page names of every Space, read when the palette opens. */
function useSpacePages(open: boolean): Record<string, string[]> {
  const spaces = useSpacesStore((s) => s.spaces);
  const [pages, setPages] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (open) void useSpacesStore.getState().refresh();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.allSettled(spaces.map((s) => call('spaces:pages', { space: s.name }))).then(
      (all) => {
        if (!live) return;
        setPages(
          Object.fromEntries(
            spaces.map((s, i) => {
              const r = all[i];
              return [s.name, r?.status === 'fulfilled' ? r.value.map((p) => p.name) : []];
            }),
          ),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [open, spaces]);
  return pages;
}

/**
 * Ctrl+K: one box that finds screens, settings, tasks, events, Spaces pages, chats and memory
 * notes, and runs a few actions. Arrows move, Enter opens, Esc closes.
 */
export function Palette(): React.JSX.Element | null {
  const onboarded = useSetting('onboarding.complete');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const todos = usePlannerStore((s) => s.todos);
  const events = usePlannerStore((s) => s.events);
  const chats = useChatStore((s) => s.conversations);
  const spaces = useSpacesStore((s) => s.spaces);
  const pages = useSpacePages(open);
  const remote = useRemoteHits(open ? query : '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    if (!usePlannerStore.getState().loaded) void usePlannerStore.getState().refresh();
  }, [open]);

  const local = useMemo(
    () =>
      localItems({
        views: NAV_ITEMS,
        settings: SETTINGS_SECTIONS,
        todos,
        events,
        spaces: spaces.map((s) => ({ name: s.name, pages: pages[s.name] ?? [] })),
        chats,
      }),
    [todos, events, spaces, pages, chats],
  );
  const results = useMemo(
    () => groupItems([...matchItems(local, query), ...remote], query),
    [local, query, remote],
  );
  const current = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [current, results]);

  if (!onboarded) return null;

  const choose = (item: PaletteItem | undefined): void => {
    if (!item) return;
    setOpen(false);
    run(item.run);
  };
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[current]);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim fade-in fixed inset-0 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[14vh] left-1/2 z-50 flex max-h-[64vh] w-[min(38rem,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden dialog modal-in"
        >
          <Dialog.Title className="sr-only">Search Jarvis</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
            <Search size={16} aria-hidden className="shrink-0 text-ink-500" />
            <input
              role="combobox"
              aria-label="Search screens, tasks, chats, memory"
              aria-expanded
              aria-controls="palette-results"
              aria-activedescendant={results[current] ? `palette-${current}` : undefined}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search or jump to…"
              className="h-12 min-w-0 flex-1 border-0! bg-transparent text-ui text-ink-100 shadow-none! outline-none! placeholder:text-ink-500"
            />
            <kbd className="font-code text-3xs text-ink-500">Esc</kbd>
          </div>
          <ul
            ref={listRef}
            id="palette-results"
            role="listbox"
            aria-label="Results"
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {results.length === 0 && (
              <li role="presentation" className="px-3 py-6 text-center text-sm text-ink-500">
                Nothing found for “{query.trim()}”.
              </li>
            )}
            {results.map((item, i) => (
              <li key={item.id} role="presentation">
                {item.group !== results[i - 1]?.group && (
                  <p aria-hidden className="hud-label px-2.5 pt-2.5 pb-1">
                    {item.group}
                  </p>
                )}
                <div
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={i === current}
                  aria-label={`${item.group}: ${item.label}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                  className={`flex cursor-pointer items-baseline gap-3 rounded-md px-2.5 py-2 text-sm ${
                    i === current ? 'bg-selected text-ink-100' : 'text-ink-300'
                  }`}
                >
                  <span className="max-w-[65%] shrink-0 truncate">{item.label}</span>
                  {item.hint && (
                    <span className="min-w-0 truncate text-xs text-ink-500">{item.hint}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
