import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Search, Sparkles, X } from 'lucide-react';
import clsx from 'clsx';
import { BRAIN_IDS, BRAIN_LABELS } from '@shared/llm-providers';
import {
  NPC_COLORS,
  NPC_NAME_RE,
  NPC_TEMPLATES,
  type Npc,
  type NpcInput,
  type NpcTemplate,
} from '@shared/npcs';
import { Button, IconButton } from '../../components/ui/button';
import { Switch, TextInput } from '../../components/ui/field';
import { toInput, useNpcStore } from '../../stores/npc-store';
import { NPC_HEX, NpcBadge, npcStyle } from './npc-kit';

/** Hire an NPC from a template (or from scratch), or change one. */

const BLANK: NpcInput = {
  name: '',
  role: '',
  emoji: '🤖',
  color: 'cyan',
  brain: 'jarvis',
  instructions: '',
  tools: [],
  enabled: true,
  templateId: null,
};

const fromTemplate = (t: NpcTemplate): NpcInput => ({
  name: t.name,
  role: t.role,
  emoji: t.emoji,
  color: t.color,
  brain: 'jarvis',
  instructions: t.instructions,
  tools: t.tools,
  enabled: true,
  templateId: t.id,
});

function Templates({ onPick }: { onPick(i: NpcInput): void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <button
        type="button"
        onClick={() => onPick(BLANK)}
        className="flex flex-col items-start gap-1 rounded-md border border-dashed border-line-strong p-3 text-left transition-colors hover:border-accent-edge hover:bg-hover"
      >
        <Sparkles size={20} className="text-accent-300" aria-hidden />
        <span className="font-semibold text-ink-100">From scratch</span>
        <span className="text-xs text-ink-500">Your own role and brief.</span>
      </button>
      {NPC_TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(fromTemplate(t))}
          style={npcStyle(t.color)}
          className="group flex flex-col items-start gap-1 rounded-md border border-line p-3 text-left transition-[border-color,translate] hover:-translate-y-0.5 hover:border-(--npc)"
        >
          <span className="flex items-center gap-2">
            <NpcBadge npc={t} size="sm" />
            <span className="font-semibold text-ink-100">{t.role}</span>
          </span>
          <span className="text-xs text-ink-500">{t.blurb}</span>
        </button>
      ))}
    </div>
  );
}

export function NpcEditor({
  npc,
  onClose,
}: {
  /** Undefined = hiring a new one. */
  npc?: Npc | undefined;
  onClose(): void;
}): React.JSX.Element {
  const brains = useNpcStore((s) => s.brains);
  const brainLabels = useNpcStore((s) => s.brainLabels);
  const tools = useNpcStore((s) => s.tools);
  const save = useNpcStore((s) => s.save);
  const [form, setForm] = useState<NpcInput | null>(npc ? toInput(npc) : null);
  const [toolQuery, setToolQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NpcInput>(k: K, v: NpcInput[K]): void =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const shownTools = useMemo(
    () =>
      tools.filter(
        (t) =>
          !toolQuery ||
          t.name.includes(toolQuery.toLowerCase()) ||
          t.description.toLowerCase().includes(toolQuery.toLowerCase()),
      ),
    [tools, toolQuery],
  );
  const nameOk = form ? NPC_NAME_RE.test(form.name) : false;
  const valid =
    form && nameOk && form.role.trim().length >= 2 && form.instructions.trim().length >= 10;

  async function submit(): Promise<void> {
    if (!form || !valid) return;
    setBusy(true);
    const saved = await save({ ...form, name: form.name.trim(), role: form.role.trim() }, npc?.id);
    setBusy(false);
    if (saved) onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim fade-in fixed inset-0 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="dialog modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(44rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col"
        >
          <div
            className="h-1 rounded-t-md"
            style={{ background: form ? NPC_HEX[form.color] : 'var(--accent-500)' }}
          />
          <header className="flex items-center gap-2 px-5 pt-4">
            {!npc && form && (
              <IconButton label="Back to templates" onClick={() => setForm(null)}>
                <ArrowLeft size={16} aria-hidden />
              </IconButton>
            )}
            <Dialog.Title className="font-code text-xs font-semibold tracking-widest text-ink-500 uppercase">
              {npc ? `Edit ${npc.name}` : form ? 'New NPC' : 'Hire an NPC'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close" className="ml-auto">
                <X size={16} aria-hidden />
              </IconButton>
            </Dialog.Close>
          </header>
          {!form ? (
            <div className="overflow-y-auto px-5 pt-3 pb-5">
              <p className="mb-3 text-sm text-ink-300">
                Pick a ready-made specialist (you can change everything) or start from scratch.
              </p>
              <Templates onPick={setForm} />
            </div>
          ) : (
            <form
              className="flex flex-col gap-4 overflow-y-auto px-5 pt-3 pb-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="flex items-start gap-4">
                <NpcBadge npc={form} size="lg" />
                <div className="grid flex-1 grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs text-ink-500">
                    Name
                    <TextInput
                      value={form.name}
                      onChange={(e) => set('name', e.target.value)}
                      aria-invalid={form.name !== '' && !nameOk}
                      placeholder="Maya"
                      maxLength={24}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-500">
                    Role
                    <TextInput
                      value={form.role}
                      onChange={(e) => set('role', e.target.value)}
                      placeholder="Marketing Head"
                      maxLength={60}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-500">
                    Emoji
                    <TextInput
                      value={form.emoji}
                      onChange={(e) => set('emoji', e.target.value.slice(0, 8))}
                      className="w-20 text-center text-lg"
                    />
                  </label>
                  <fieldset className="flex flex-col gap-1 text-xs text-ink-500">
                    <legend className="mb-1">Colour</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {NPC_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={c}
                          aria-pressed={form.color === c}
                          onClick={() => set('color', c)}
                          className={clsx(
                            'size-6 rounded-pill transition-transform',
                            form.color === c &&
                              'scale-110 ring-2 ring-ink-100 ring-offset-2 ring-offset-surface-1',
                          )}
                          style={{ background: NPC_HEX[c] }}
                        />
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-xs text-ink-500">
                Brain (which AI does its work)
                <select
                  value={form.brain}
                  onChange={(e) => set('brain', e.target.value as NpcInput['brain'])}
                  className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
                >
                  {BRAIN_IDS.map((b) => (
                    <option key={b} value={b} disabled={!brains.includes(b) && b !== form.brain}>
                      {BRAIN_LABELS[b]}
                      {brains.includes(b) ? '' : ' (not set up)'}
                    </option>
                  ))}
                  {/* Sir's extra keys (Settings → Brain → Connections) */}
                  {[
                    ...new Set([
                      ...brains.filter((b) => b.startsWith('conn_')),
                      ...(form.brain.startsWith('conn_') ? [form.brain] : []),
                    ]),
                  ].map((b) => (
                    <option key={b} value={b} disabled={!brains.includes(b)}>
                      {brainLabels[b] ?? b}
                      {brains.includes(b) ? '' : ' (not set up)'}
                    </option>
                  ))}
                </select>
                <span className="text-ink-500">
                  Set up more AIs in Settings → Brain. The ChatGPT and Gemini plans only think and
                  write (no tools).
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-500">
                Brief (its one job, and how to do it)
                <textarea
                  value={form.instructions}
                  onChange={(e) => set('instructions', e.target.value)}
                  rows={5}
                  maxLength={4000}
                  className="rounded-sm border border-line bg-surface-1 px-3 py-2 text-sm leading-relaxed text-ink-100"
                />
              </label>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs text-ink-500">
                  Tools ({form.tools.length}) · Jarvis&apos;s safety rules and confirmations still
                  apply
                </legend>
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute top-2.5 left-2.5 text-ink-500"
                    aria-hidden
                  />
                  <TextInput
                    value={toolQuery}
                    onChange={(e) => setToolQuery(e.target.value)}
                    placeholder="Find a tool"
                    aria-label="Find a tool"
                    className="w-full pl-8 text-sm"
                  />
                </div>
                <div className="grid max-h-44 grid-cols-1 gap-0.5 overflow-y-auto rounded-sm border border-line-subtle p-1 sm:grid-cols-2">
                  {shownTools.map((t) => {
                    const on = form.tools.includes(t.name);
                    return (
                      <label
                        key={t.name}
                        title={t.description}
                        className={clsx(
                          'flex cursor-pointer items-center gap-2 rounded-xs px-2 py-1 text-xs',
                          on ? 'bg-selected text-ink-100' : 'text-ink-300 hover:bg-hover',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            set(
                              'tools',
                              on ? form.tools.filter((x) => x !== t.name) : [...form.tools, t.name],
                            )
                          }
                        />
                        <span className="truncate font-code">{t.name}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <Switch
                checked={form.enabled}
                onChange={(v) => set('enabled', v)}
                label="Switched on"
              />
              <div className="flex justify-end gap-2 border-t border-line-subtle pt-3">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={!valid || busy}>
                  {npc ? 'Save' : 'Hire'}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
