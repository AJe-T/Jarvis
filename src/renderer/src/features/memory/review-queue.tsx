import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Res } from '@shared/ipc-contract';
import { call } from '../../lib/api';
import { useMemoryStore } from '../../stores/memory-store';

/** Memory proposals the curator was unsure about, or that looked like instructions (Security.md §6.6). */
export function ReviewQueue(): React.JSX.Element | null {
  const [items, setItems] = useState<Res<'memory:reviewList'>>([]);
  const version = useMemoryStore((s) => s.version);
  const bump = useMemoryStore((s) => s.bump);

  useEffect(() => {
    void call('memory:reviewList', {}).then(setItems);
  }, [version]);

  if (items.length === 0) return null;

  async function resolve(id: string, decision: 'accepted' | 'rejected'): Promise<void> {
    await call('memory:reviewResolve', { id, decision });
    bump();
  }

  return (
    <section
      aria-label="Memories to review"
      className="max-h-72 overflow-y-auto border-t border-glass-border p-3"
    >
      <h2 className="mb-2 text-sm font-semibold text-lamp-400">
        Review {items.length === 1 ? '1 memory' : `${items.length} memories`}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.id} className="rounded-sm border border-glass-border p-2 text-xs">
            <p className="text-ink-300">{i.reason}</p>
            {i.targetPath && <p className="mt-1 font-code text-ink-500">{i.targetPath}</p>}
            {i.proposedMarkdown && (
              <pre className="mt-1 font-code whitespace-pre-wrap text-ink-100">
                {i.proposedMarkdown}
              </pre>
            )}
            <div className="mt-2 flex gap-2">
              {i.proposedMarkdown && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-ok-400 hover:underline"
                  onClick={() => void resolve(i.id, 'accepted')}
                >
                  <Check size={12} aria-hidden /> Save it
                </button>
              )}
              <button
                type="button"
                className="flex items-center gap-1 text-ink-300 hover:underline"
                onClick={() => void resolve(i.id, 'rejected')}
              >
                <X size={12} aria-hidden /> Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
