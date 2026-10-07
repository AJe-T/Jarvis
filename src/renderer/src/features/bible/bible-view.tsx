import { useMemo, useState } from 'react';
import clsx from 'clsx';
import bible from '../../../../../docs/BIBLE.md?raw';
import reference from '../../../../../docs/REFERENCE.md?raw';
import { Markdown } from '../../components/jarvis/chat-message';
import { TextInput } from '../../components/ui/field';

interface Part {
  title: string;
  body: string;
}

/** Splits a document at its "## " headings; the text before the first heading is the introduction. */
export function splitSections(md: string): Part[] {
  const parts: Part[] = [];
  let current: Part = { title: 'Introduction', body: '' };
  for (const line of md.split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h?.[1]) {
      if (current.body.trim()) parts.push(current);
      current = { title: h[1].trim(), body: `${line}\n` };
    } else current.body += `${line}\n`;
  }
  if (current.body.trim()) parts.push(current);
  return parts;
}

const DOCS = {
  bible: { label: 'Bible', md: bible },
  reference: { label: 'Reference (generated)', md: reference },
};

/** ADR-019: the project Bible inside the app, with contents and search. */
export function BibleView(): React.JSX.Element {
  const [doc, setDoc] = useState<keyof typeof DOCS>('bible');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const sections = useMemo(() => splitSections(DOCS[doc].md), [doc]);
  const q = query.trim().toLowerCase();
  const matches = q
    ? sections.map((s, i) => ({ s, i })).filter(({ s }) => s.body.toLowerCase().includes(q))
    : sections.map((s, i) => ({ s, i }));
  const shown = q ? matches.map((m) => m.s) : [sections[active] ?? sections[0]].filter(Boolean);

  return (
    <div className="flex min-w-0 flex-1">
      <nav
        aria-label="Bible contents"
        className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-glass-border px-3 py-4"
      >
        <h1 className="px-2 text-xl font-semibold text-ink-100">JARVIS Bible</h1>
        <div role="tablist" className="flex gap-1">
          {(Object.keys(DOCS) as Array<keyof typeof DOCS>).map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={doc === d}
              onClick={() => (setDoc(d), setActive(0), setQuery(''))}
              className={clsx(
                'rounded-pill px-3 py-1 text-xs',
                doc === d ? 'bg-glass-selected text-ink-100' : 'text-ink-300 hover:text-ink-100',
              )}
            >
              {DOCS[d].label}
            </button>
          ))}
        </div>
        <TextInput
          aria-label="Search the Bible"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ol className="flex flex-col gap-0.5">
          {matches.map(({ s, i }) => (
            <li key={`${doc}-${i}`}>
              <button
                type="button"
                aria-current={!q && i === active ? 'page' : undefined}
                onClick={() => (setActive(i), setQuery(''))}
                className={clsx(
                  'w-full rounded-md px-2 py-1 text-left text-sm',
                  !q && i === active
                    ? 'bg-glass-selected text-ink-100'
                    : 'text-ink-300 hover:bg-glass-hover',
                )}
              >
                {s.title}
              </button>
            </li>
          ))}
          {q && matches.length === 0 && (
            <li className="px-2 text-sm text-ink-500">Nothing found.</li>
          )}
        </ol>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <article className="bible mx-auto flex max-w-3xl flex-col gap-8 text-sm text-ink-300">
          {shown.map((s) => (
            <section key={s?.title}>
              <Markdown text={s?.body ?? ''} />
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
