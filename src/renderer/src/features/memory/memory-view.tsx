import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  Search,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Markdown } from '../../components/jarvis/chat-message';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useMemoryStore } from '../../stores/memory-store';
import { useUiStore } from '../../stores/ui-store';
import { ReviewQueue } from './review-queue';

type Entry = Res<'memory:list'>[number];

function splitFrontmatter(md: string): { meta: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  return m ? { meta: m[1] ?? '', body: md.slice(m[0].length) } : { meta: '', body: md };
}

function TreeNode({
  entry,
  depth,
  selected,
  onSelect,
}: {
  entry: Entry;
  depth: number;
  selected: string | null;
  onSelect(p: string): void;
}): React.JSX.Element {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const version = useMemoryStore((s) => s.version);

  useEffect(() => {
    if (entry.isDir && open) void call('memory:list', { dir: entry.path }).then(setChildren);
  }, [entry, open, version]);

  if (!entry.isDir) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelect(entry.path)}
          aria-current={selected === entry.path ? 'true' : undefined}
          className={clsx(
            'flex min-h-8 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-sm transition-colors duration-[160ms]',
            selected === entry.path
              ? 'bg-selected font-medium text-ink-100'
              : 'text-ink-300 hover:bg-hover hover:text-ink-100',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <FileText size={14} aria-hidden className="shrink-0" />
          <span className="truncate">{entry.name.replace(/\.md$/, '')}</span>
        </button>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-8 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-sm text-ink-100 hover:bg-hover"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <Folder size={14} aria-hidden className="text-ink-500" />
        {entry.name}
      </button>
      {open && children && (
        <ul>
          {children.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Design-system.md §5.6: tree of Memory/ on the left, the rendered note on the right. */
export function MemoryView(): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>('Memory/About Sir.md');
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Res<'memory:search'> | null>(null);
  const version = useMemoryStore((s) => s.version);
  const bump = useMemoryStore((s) => s.bump);
  const toast = useUiStore((s) => s.toast);
  const go = useUiStore((s) => s.go);

  const load = useCallback(async (p: string) => {
    try {
      setNote((await call('memory:read', { vaultPath: p })).markdown);
    } catch {
      setNote(null);
    }
  }, []);

  useEffect(() => {
    if (selected) void load(selected);
  }, [selected, load, version]);

  async function forget(): Promise<void> {
    if (!selected) return;
    const okd = await confirmAction({
      title: `Forget "${selected.replace(/^Memory\//, '').replace(/\.md$/, '')}"?`,
      body: "The note moves to the vault's .trash folder (you can restore it in Obsidian) and Jarvis stops using it.",
      actionLabel: 'Forget',
      destructive: true,
    });
    if (!okd) return;
    try {
      await call('memory:delete', { vaultPath: selected });
      setSelected(null);
      setNote(null);
      bump();
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    }
  }

  const { meta, body } = note ? splitFrontmatter(note) : { meta: '', body: '' };

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label="Memory notes"
        className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-line-subtle md:w-64"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pr-2 pl-4">
          <h1 className="text-ui font-semibold text-ink-100">Memory</h1>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => void call('memory:openInObsidian', {})}
          >
            <ExternalLink size={14} aria-hidden /> Vault
          </Button>
        </div>
        <form
          className="relative p-3"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) void call('memory:search', { query: query.trim() }).then(setHits);
            else setHits(null);
          }}
        >
          <Search size={14} aria-hidden className="absolute top-[23px] left-5.5 text-icon-rest" />
          <TextInput
            aria-label="Search memory"
            placeholder="Search memory"
            value={query}
            onChange={(e) => (setQuery(e.target.value), !e.target.value && setHits(null))}
            className="w-full pl-7 text-sm"
          />
        </form>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {hits ? (
            <ul aria-label="Search results">
              {hits.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">No matches.</li>}
              {hits.map((h) => (
                <li key={h.vaultPath}>
                  <button
                    type="button"
                    onClick={() => {
                      const sp = /^Spaces\/([^/]+)\/(.+)\.md$/.exec(h.vaultPath);
                      if (sp) go('spaces', `${sp[1]}/${sp[2]}`);
                      else setSelected(h.vaultPath);
                    }}
                    className="w-full rounded-sm px-3 py-2 text-left transition-colors duration-[160ms] hover:bg-hover"
                  >
                    <span className="block text-sm text-ink-100">{h.title}</span>
                    <span className="block truncate text-xs text-ink-500">{h.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              <TreeNode
                entry={{ path: 'Memory', name: 'Memory', isDir: true, size: 0 }}
                depth={0}
                selected={selected}
                onSelect={setSelected}
              />
            </ul>
          )}
        </div>
        <ReviewQueue />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Note">
        {selected && note !== null ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-4 md:px-6">
              <h2 className="truncate text-lg font-semibold">
                {selected.replace(/^Memory\//, '').replace(/\.md$/, '')}
              </h2>
              <div className="ml-auto flex gap-2">
                <Button onClick={() => void call('memory:openInObsidian', { vaultPath: selected })}>
                  <ExternalLink size={14} aria-hidden /> Open in Obsidian
                </Button>
                <Button variant="ghost" className="text-alarm-500" onClick={() => void forget()}>
                  <Trash2 size={14} aria-hidden /> Forget
                </Button>
              </div>
            </header>
            <div key={selected} className="fade-in flex-1 overflow-y-auto px-4 md:px-6">
              <div className="mx-auto max-w-3xl py-6">
                {meta && (
                  <pre className="mb-6 overflow-x-auto rounded-md bg-surface-2 px-4 py-3 font-code text-xs leading-5 text-ink-500">
                    {meta}
                  </pre>
                )}
                <Markdown text={body} />
              </div>
            </div>
          </>
        ) : (
          <p className="m-auto text-ink-500">Choose a note to read it.</p>
        )}
      </section>
    </div>
  );
}
