import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { BookOpen, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { BRAIN_LABELS } from '@shared/llm-providers';
import { dmChannel, type Npc } from '@shared/npcs';
import { Button, IconButton } from '../../components/ui/button';
import { Switch } from '../../components/ui/field';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call } from '../../lib/api';
import { useNpcStore } from '../../stores/npc-store';
import { NPC_HEX, NpcBadge, STATE_LABEL, StateDot, npcStyle } from './npc-kit';

/** One NPC's file: what it does, its AI and tools, its memory; switch it on/off, edit, fire. */
export function Dossier({
  npc,
  onEdit,
  onChat,
  onClose,
}: {
  npc: Npc;
  onEdit(): void;
  onChat(channel: string): void;
  onClose?: () => void;
}): React.JSX.Element {
  const state = useNpcStore((s) => (npc.enabled ? (s.states[npc.id] ?? 'idle') : 'off'));
  const toggle = useNpcStore((s) => s.toggle);
  const remove = useNpcStore((s) => s.remove);
  const [memory, setMemory] = useState<{ path: string; markdown: string } | null>(null);
  useEffect(() => {
    setMemory(null);
    void call('npcs:memory', { id: npc.id }).then(setMemory);
  }, [npc.id, state]);

  async function fire(): Promise<void> {
    const ok = await confirmAction({
      title: `Remove ${npc.name}?`,
      body: `${npc.name} leaves the team and your private chat with them is deleted. Their memory note (${memory?.path ?? 'in the vault'}) and what they said in the office stay.`,
      actionLabel: 'Remove',
      destructive: true,
    });
    if (ok) {
      await remove(npc.id);
      onClose?.();
    }
  }

  return (
    <article style={npcStyle(npc.color)} className="flex min-h-0 flex-col" aria-label={npc.name}>
      <div className="h-1 bg-(--npc)" />
      <header className="flex items-start gap-3 p-4">
        <NpcBadge npc={npc} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-ink-100">{npc.name}</h2>
          <p className="text-sm text-ink-300">{npc.role}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
            <StateDot state={state} /> {STATE_LABEL[state]}
          </p>
        </div>
        {onClose && (
          <IconButton label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        )}
      </header>
      <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" className="h-8" onClick={() => onChat(dmChannel(npc.id))}>
            <MessageSquare size={14} aria-hidden /> Message
          </Button>
          <Button className="h-8" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Edit
          </Button>
          <IconButton label={`Remove ${npc.name}`} onClick={() => void fire()}>
            <Trash2 size={15} aria-hidden />
          </IconButton>
        </div>
        <Switch checked={npc.enabled} onChange={() => void toggle(npc)} label="Switched on" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-ink-500">Brain</dt>
          <dd className="text-ink-100">{BRAIN_LABELS[npc.brain]}</dd>
          <dt className="text-ink-500">Tools</dt>
          <dd className="flex flex-wrap gap-1">
            {npc.tools.length === 0 && <span className="text-ink-500">none (talks only)</span>}
            {npc.tools.map((t) => (
              <span
                key={t}
                className="rounded-xs bg-surface-2 px-1.5 font-code text-xs text-ink-300"
              >
                {t}
              </span>
            ))}
          </dd>
        </dl>
        <section>
          <h3 className="hud-label mb-1.5">brief</h3>
          <p className="text-sm whitespace-pre-wrap text-ink-300">{npc.instructions}</p>
        </section>
        <section>
          <h3 className="hud-label mb-1.5 flex items-center gap-1.5">
            <BookOpen size={12} aria-hidden /> memory
          </h3>
          {memory?.markdown ? (
            <div className="prose-chat rounded-sm border border-line-subtle bg-surface-1 p-3 text-sm text-ink-300">
              <ReactMarkdown>{memory.markdown}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              Nothing kept yet. {npc.name} saves facts here as they work; Jarvis can read it too.
            </p>
          )}
        </section>
      </div>
    </article>
  );
}

/** Everyone on the team, with quick on/off. */
export function Roster({
  onHire,
  onEdit,
  onChat,
}: {
  onHire(): void;
  onEdit(n: Npc): void;
  onChat(channel: string): void;
}): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const states = useNpcStore((s) => s.states);
  const toggle = useNpcStore((s) => s.toggle);
  const [open, setOpen] = useState<string | null>(null);
  const current = npcs.find((n) => n.id === open);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink-100">Your team</h2>
              <p className="text-sm text-ink-300">
                Each NPC does one job with its own AI, tools and memory. Jarvis leads them and can
                read every memory.
              </p>
            </div>
            <Button variant="primary" onClick={onHire}>
              <Plus size={15} aria-hidden /> Hire NPC
            </Button>
          </div>
          {npcs.length === 0 && (
            <button
              type="button"
              onClick={onHire}
              className="rounded-md border border-dashed border-line-strong p-10 text-center text-sm text-ink-300 hover:border-accent-edge"
            >
              No NPCs yet. Hire your first one from 10 templates (Marketing, Finance, Developers,
              Research…) or build your own.
            </button>
          )}
          {npcs.map((n) => {
            const state = n.enabled ? (states[n.id] ?? 'idle') : 'off';
            return (
              <div
                key={n.id}
                style={npcStyle(n.color)}
                className={clsx(
                  'group flex items-center gap-4 rounded-md border border-l-4 border-line border-l-(--npc) bg-surface-1 px-4 py-3 transition-colors hover:border-line-strong',
                  open === n.id && 'border-accent-edge',
                  !n.enabled && 'opacity-60',
                )}
              >
                <NpcBadge npc={n} size="md" state={state} />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setOpen(open === n.id ? null : n.id)}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold text-ink-100">{n.name}</span>
                    <span className="truncate text-sm text-ink-300">{n.role}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-500">
                    {BRAIN_LABELS[n.brain]} · {n.tools.length} tools · {STATE_LABEL[state]}
                  </span>
                </button>
                <span
                  className="hidden h-6 w-px bg-line md:block"
                  style={{ background: NPC_HEX[n.color] }}
                  aria-hidden
                />
                <IconButton label={`Message ${n.name}`} onClick={() => onChat(dmChannel(n.id))}>
                  <MessageSquare size={15} aria-hidden />
                </IconButton>
                <IconButton label={`Edit ${n.name}`} onClick={() => onEdit(n)}>
                  <Pencil size={15} aria-hidden />
                </IconButton>
                <div className="w-24">
                  <Switch
                    checked={n.enabled}
                    onChange={() => void toggle(n)}
                    label={n.enabled ? 'On' : 'Off'}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {current && (
        <aside className="w-96 shrink-0 border-l border-line-subtle max-lg:hidden">
          <Dossier
            npc={current}
            onEdit={() => onEdit(current)}
            onChat={onChat}
            onClose={() => setOpen(null)}
          />
        </aside>
      )}
    </div>
  );
}
