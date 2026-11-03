import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { ChevronLeft, FileText, Folder } from 'lucide-react';
import type { Res } from '@shared/ipc-contract';
import { call, cleanError } from '../../lib/api';

/**
 * F10: Forge's own memory, read-only: its notes, a note per finished run, its chats and its notebooks,
 * all in <vault>/Forge (Obsidian edits them). Jarvis can read these; Forge never reads Jarvis's.
 */

type Entry = Res<'forge:files'>[number];

const ROOTS: Array<{ dir: string; label: string; hint: string }> = [
  {
    dir: 'Forge/Memories',
    label: 'Memories',
    hint: 'Notes Forge kept, and a note per finished run',
  },
  { dir: 'Forge/Spaces', label: 'Spaces', hint: "Forge's notebooks: plans, specs, designs" },
  { dir: 'Forge/Chats', label: 'Chats', hint: 'Your chats with Forge, one file per day' },
];

// Chat files hold hidden message markers; Obsidian hides them, and so does this view.
const MARKERS = /^<!-- forge:msg [^\n]*-->\n?/gm;

export function ForgeMemory(): React.JSX.Element {
  const [dir, setDir] = useState(ROOTS[0]?.dir ?? 'Forge');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<{ path: string; markdown: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((d: string) => {
    setDir(d);
    setEntries(null);
    setError(null);
    call('forge:files', { dir: d })
      .then((e) =>
        setEntries(
          [...e].sort((a, b) => Number(b.isDir) - Number(a.isDir) || b.name.localeCompare(a.name)),
        ),
      )
      .catch((err: unknown) => {
        setEntries([]);
        setError(cleanError(err));
      });
  }, []);
  useEffect(() => open(dir), []); // eslint-disable-line react-hooks/exhaustive-deps

  const read = (path: string): void => {
    setError(null);
    call('forge:file', { path })
      .then(setFile)
      .catch((err: unknown) => setError(cleanError(err)));
  };

  const parent =
    dir.includes('/') && !ROOTS.some((r) => r.dir === dir)
      ? dir.slice(0, dir.lastIndexOf('/'))
      : null;

  return (
    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(14rem,18rem)_1fr]">
      <nav aria-label="Forge memory folders" className="flex min-h-0 flex-col gap-3">
        <ul className="flex flex-wrap gap-1.5">
          {ROOTS.map((r) => (
            <li key={r.dir}>
              <button
                type="button"
                title={r.hint}
                aria-pressed={dir.startsWith(r.dir)}
                onClick={() => {
                  setFile(null);
                  open(r.dir);
                }}
                className={clsx(
                  'rounded-pill border px-2.5 py-1 text-xs',
                  dir.startsWith(r.dir)
                    ? 'border-accent-edge bg-accent-tint text-ink-100'
                    : 'border-line text-ink-500 hover:text-ink-100',
                )}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
        {parent && (
          <button
            type="button"
            onClick={() => open(parent)}
            className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-100"
          >
            <ChevronLeft size={14} aria-hidden /> {parent.replace(/^Forge\//, '')}
          </button>
        )}
        {entries === null && <span className="skeleton block h-24 w-full" aria-hidden />}
        {entries?.length === 0 && !error && (
          <p className="text-sm text-ink-500">
            Nothing here yet. Forge fills it as you work together.
          </p>
        )}
        {entries && entries.length > 0 && (
          <ul aria-label={dir} className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {entries.map((e) => (
              <li key={e.path}>
                <button
                  type="button"
                  onClick={() => (e.isDir ? open(e.path) : read(e.path))}
                  aria-current={file?.path === e.path ? 'true' : undefined}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm',
                    file?.path === e.path
                      ? 'bg-surface-2 text-ink-100'
                      : 'text-ink-300 hover:bg-surface-1',
                  )}
                >
                  {e.isDir ? (
                    <Folder size={14} aria-hidden className="shrink-0 text-lamp-400" />
                  ) : (
                    <FileText size={14} aria-hidden className="shrink-0 text-ink-500" />
                  )}
                  <span className="truncate">{e.name.replace(/\.md$/i, '')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <section aria-label="Note" className="card min-h-64 overflow-y-auto p-4">
        {error && <p className="text-sm text-alarm-500">{error}</p>}
        {!file && !error && (
          <p className="text-sm text-ink-500">
            Pick a note. Forge&apos;s memory is separate from yours: Jarvis can read it, Forge
            can&apos;t read your memory, Spaces or chats. Edit these files in Obsidian (the Forge
            folder of your vault).
          </p>
        )}
        {file && (
          <article className="prose-chat text-sm text-ink-100">
            <p className="mb-3 font-code text-xs text-ink-500 select-all">{file.path}</p>
            {/* Run notes hold Claude's summaries; rendered as Markdown, links are not followed. */}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ a: ({ children }) => <span className="underline">{children}</span> }}
            >
              {file.markdown.replace(MARKERS, '')}
            </ReactMarkdown>
          </article>
        )}
      </section>
    </div>
  );
}
