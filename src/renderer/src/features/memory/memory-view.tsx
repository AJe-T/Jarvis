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
            // §6.9: selected note = violet tint + 2px violet edge.
            selected === entry.path
              ? 'bg-glass-selected text-ink-100 shadow-[inset_2px_0_0_var(--accent-500)]'
              : 'text-ink-300 hover:bg-glass-hover hover:text-ink-100',
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
        className="flex min-h-8 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-sm text-ink-100 hover:bg-glass-hover"
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
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <aside
        aria-label="Memory notes"
        className="glass-inset flex w-56 shrink-0 flex-col overflow-hidden rounded-lg md:w-72"
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <h1 className="text-lg font-semibold">Memory</h1>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => void call('memory:openInObsidian', {})}
          >
            <ExternalLink size={14} aria-hidden /> Vault
          </Button>
        </div>
        <form
          className="relative px-3 pb-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) void call('memory:search', { query: query.trim() }).then(setHits);
            else setHits(null);
          }}
        >
          <Search size={14} aria-hidden className="absolute top-3 left-5.5 text-reactor-500/70" />
          <TextInput
            aria-label="Search memory"
            placeholder="Search memory"
            value={query}
            onChange={(e) => (setQuery(e.target.value), !e.target.value && setHits(null))}
            className="w-full pl-7 text-sm"
          />
        </form>
        <div className="flex-1 overflow-y-auto px-1 pb-3">
          {hits ? (
            <ul aria-label="Search results">
              {hits.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">No matches.</li>}
              {hits.map((h) => (
                <li key={h.vaultPath}>
                  <button
                    type="button"
                    onClick={() => setSelected(h.vaultPath)}
                    className="w-full rounded-sm px-3 py-2 text-left transition-colors duration-[160ms] hover:bg-glass-hover"
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

      <section
        className="glass-raised flex min-w-0 flex-1 flex-col overflow-hidden"
        aria-label="Note"
      >
        {selected && note !== null ? (
          <>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-glass-border px-6">
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
            <div key={selected} className="fade-in flex-1 overflow-y-auto px-6 py-7 md:px-10">
              <div className="mx-auto max-w-[72ch]">
                {meta && (
                  <pre className="mb-6 overflow-x-auto rounded-md border border-glass-border bg-glass-inset px-4 py-3 font-code text-xs leading-5 text-ink-500">
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
