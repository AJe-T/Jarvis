import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Package, Search } from 'lucide-react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import type { Candidate } from './candidate';

type Entry = Res<'mcp:registrySearch'>['entries'][number];
const DEBOUNCE_MS = 400;

/**
 * The official MCP Registry inside Jarvis: search thousands of servers, add one in two clicks.
 * Everything found here is community-trust and asks before every tool, like a custom server.
 */
export function RegistryBrowser({
  existing,
  onPick,
}: {
  existing: string[];
  onPick(c: Candidate): void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);

  const load = useCallback(async (q: string, after?: string): Promise<void> => {
    const mine = ++ticket.current;
    setBusy(true);
    setError(null);
    try {
      const page = await call('mcp:registrySearch', {
        query: q,
        ...(after ? { cursor: after } : {}),
      });
      if (mine !== ticket.current) return; // a newer search won
      setEntries((prev) => (after ? [...prev, ...page.entries] : page.entries));
      setSkipped((prev) => (after ? prev : 0) + page.skipped);
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine === ticket.current) setError(cleanError(err));
    } finally {
      if (mine === ticket.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, load]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-300">
        The official{' '}
        <span className="font-code text-accent-300">registry.modelcontextprotocol.io</span>{' '}
        catalogue. Community servers: Jarvis asks before every tool they run. Only add what you
        trust.
      </p>
      <div className="relative">
        <Search
          size={14}
          aria-hidden
          className="absolute top-1/2 left-3 -translate-y-1/2 text-icon-rest"
        />
        <TextInput
          aria-label="Search the MCP Registry"
          placeholder="Search: spotify, postgres, calendar, weather…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-8"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-alarm-500">
          {error}{' '}
          <button type="button" className="underline" onClick={() => void load(query.trim())}>
            Retry
          </button>
        </p>
      )}
      <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto pr-1" aria-busy={busy}>
        {entries.map((e) => {
          const taken = existing.includes(e.server.name);
          return (
            <li key={e.id} className="inset flex items-start gap-3 p-3">
              <span aria-hidden className="mt-0.5 text-icon-rest">
                {e.kind === 'remote' ? <Globe size={16} /> : <Package size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-code text-sm text-ink-100">{e.name}</span>
                  <span className="tag bg-neutral-tint text-ink-300">v{e.version}</span>
                  <span className="tag bg-accent-tint text-accent-tag-ink">
                    {e.kind === 'remote' ? 'hosted' : 'npm'}
                  </span>
                  {e.secrets.length > 0 && (
                    <span className="tag bg-lamp-tint text-lamp-tag-ink">needs key</span>
                  )}
                </p>
                {e.description && <p className="mt-1 text-sm text-ink-300">{e.description}</p>}
              </div>
              <Button
                className="h-8 shrink-0"
                disabled={taken}
                aria-label={`Add ${e.name}`}
                onClick={() =>
                  onPick({
                    label: e.name,
                    description: e.description,
                    secrets: e.secrets,
                    server: e.server,
                    renamable: true,
                    ...(e.repository ? { source: e.repository } : {}),
                  })
                }
              >
                {taken ? 'Added' : 'Add'}
              </Button>
            </li>
          );
        })}
        {!busy && !error && entries.length === 0 && (
          <li className="py-6 text-center text-sm text-ink-500">Nothing Jarvis can run as-is.</li>
        )}
      </ul>
      <div className="flex items-center gap-3 text-xs text-ink-500">
        {busy && <span className="ring-spin size-3.5" aria-label="Searching" />}
        {skipped > 0 && (
          <span>
            {skipped} more need Python, Docker or custom headers. Add those as a Custom server.
          </span>
        )}
        {cursor && !busy && (
          <Button
            variant="ghost"
            className="ml-auto h-8"
            onClick={() => void load(query.trim(), cursor)}
          >
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}
