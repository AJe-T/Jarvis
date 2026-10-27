import { useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, Combine, Globe, ImageIcon, Mic } from 'lucide-react';
import type { ImageSize, PoolSnapshot } from '@shared/free-pool';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { Panel, TierTag, Toggle } from './parts';
import type { PoolActions } from './router-view';

type Abilities = PoolSnapshot['abilities'];
type Setting = keyof Abilities['settings'];

const SIZES: Array<{ id: ImageSize; label: string }> = [
  { id: 'square', label: 'Square' },
  { id: 'wide', label: 'Wide (third party)' },
  { id: 'tall', label: 'Tall (third party)' },
];

/** Abilities (Phase 3, 2.33): what the free pool adds beyond chat. */
export function AbilitiesTab({
  snap,
  actions,
  onKeys,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
  /** Opens API keys, where the search keys go. */
  onKeys: () => void;
}): React.JSX.Element {
  const a = snap.abilities;
  const set = (k: Setting, v: boolean): void => actions.settings({ abilities: { [k]: v } });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SearchPanel a={a} set={set} onKeys={onKeys} />
      <ImagePanel a={a} set={set} reload={actions.reload} />
      <FusionPanel a={a} set={set} />
      <VoicePanel a={a} set={set} />
    </div>
  );
}

function SearchPanel({
  a,
  set,
  onKeys,
}: {
  a: Abilities;
  set: (k: Setting, v: boolean) => void;
  onKeys: () => void;
}): React.JSX.Element {
  const keyed = a.search.filter((p) => p.keySet).length;
  return (
    <Panel
      title="Free web search"
      aside={
        <Toggle
          label="Free web search"
          checked={a.settings.search}
          onChange={(v) => set('search', v)}
        />
      }
    >
      <Title icon={<Globe size={16} aria-hidden />}>
        Web lookups try the free search APIs first, in this order. Claude&apos;s paid web search is
        used only when they are all used up, or when the chat holds your private data (free search
        never gets it).
      </Title>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {a.search.map((p, i) => (
          <li key={p.id} className="flex items-center gap-1.5">
            <span
              className={clsx(
                'flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-1',
                p.keySet ? 'text-ink-100' : 'text-ink-500',
              )}
              title={p.pause ? `Paused: ${p.pause.reason}` : p.keySet ? 'Ready' : 'No key yet'}
            >
              <span
                aria-hidden
                className={clsx(
                  'size-2 rounded-full',
                  !p.keySet ? 'bg-ink-500' : p.pause ? 'bg-lamp-400' : 'bg-ok-400',
                )}
              />
              {p.name}
            </span>
            {i < a.search.length - 1 && (
              <ArrowRight size={12} aria-hidden className="text-ink-500" />
            )}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <ArrowRight size={12} aria-hidden className="text-ink-500" />
          <span className="rounded-sm border border-line px-2 py-1 text-ink-300">
            Claude web search (paid{a.paidSearch ? '' : ', off in Settings'})
          </span>
        </li>
      </ol>
      <p className="text-xs text-ink-500">
        {keyed ? `${keyed} of ${a.search.length} have a key. ` : 'No search key yet. '}
        <button
          type="button"
          className="text-accent-300 underline-offset-2 hover:underline"
          onClick={onKeys}
        >
          Add keys on API keys
        </button>
        .
      </p>
    </Panel>
  );
}

function ImagePanel({
  a,
  set,
  reload,
}: {
  a: Abilities;
  set: (k: Setting, v: boolean) => void;
  reload: () => void;
}): React.JSX.Element {
  const toast = useUiStore((s) => s.toast);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<ImageSize>('square');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ path: string; by: string; dataUrl: string } | null>(null);

  async function generate(): Promise<void> {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      setMade(await call('pool:image', { prompt: prompt.trim(), size }));
    } catch (e) {
      toast({ level: 'error', message: cleanError(e) });
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <Panel
      title="Image generation"
      aside={
        <Toggle
          label="Image generation"
          checked={a.settings.image}
          onChange={(v) => set('image', v)}
        />
      }
    >
      <Title icon={<ImageIcon size={16} aria-hidden />}>
        “Draw a logo for my bakery” makes a picture with a free image model and saves it to your
        vault under Images/, with a note of who made it.
      </Title>
      <ul className="flex flex-col gap-1.5 text-sm">
        {a.image.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className={clsx(
                'size-2 rounded-full',
                !m.ready ? 'bg-ink-500' : m.pause ? 'bg-lamp-400' : 'bg-ok-400',
              )}
            />
            <span className="text-ink-100">
              {m.name} · {m.model}
            </span>
            <TierTag tier={m.tier} />
            <span className="text-xs text-ink-500">
              {m.pause ? `paused: ${m.pause.reason}` : m.note}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <input
          aria-label="Describe the image"
          value={prompt}
          maxLength={1000}
          disabled={!a.settings.image || busy}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A neon owl reading a book, flat style"
          className="min-h-9 min-w-0 flex-1 rounded-sm border border-line bg-surface-1 px-3 text-sm text-ink-100 disabled:opacity-60"
        />
        <select
          aria-label="Size"
          value={size}
          disabled={!a.settings.image || busy}
          onChange={(e) => setSize(e.target.value as ImageSize)}
          className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100 disabled:opacity-60"
        >
          {SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          variant="primary"
          disabled={!a.settings.image || busy || !prompt.trim()}
        >
          {busy ? 'Drawing…' : 'Generate'}
        </Button>
      </form>
      {made ? (
        <figure className="flex flex-col gap-1.5">
          <img
            src={made.dataUrl}
            alt={prompt}
            className="max-h-72 w-auto self-start rounded-md border border-line"
          />
          <figcaption className="text-xs text-ink-300">
            Made by {made.by} · saved to {made.path}
          </figcaption>
        </figure>
      ) : (
        <div
          aria-hidden
          className="grid h-28 place-items-center rounded-md border border-dashed border-line text-xs text-ink-500"
        >
          {busy ? 'drawing…' : 'image appears here'}
        </div>
      )}
    </Panel>
  );
}

function FusionPanel({
  a,
  set,
}: {
  a: Abilities;
  set: (k: Setting, v: boolean) => void;
}): React.JSX.Element {
  return (
    <Panel
      title="Fusion brain"
      aside={
        <Toggle
          label="Fusion brain"
          checked={a.settings.fusion}
          onChange={(v) => set('fusion', v)}
        />
      }
    >
      <Title icon={<Combine size={16} aria-hidden />}>
        Up to three free models, each from a different provider, answer at once; a judge writes one
        better answer from the drafts. Tier 2 only, no tools, never your private data.
      </Title>
      {a.fusion.drafters.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex flex-col gap-1.5">
            {a.fusion.drafters.map((m) => (
              <span key={m} className="rounded-sm bg-surface-2 px-2 py-1 text-ink-100">
                {m}
              </span>
            ))}
          </div>
          <ArrowRight size={16} aria-hidden className="text-ink-500" />
          <span className="rounded-sm border border-accent-edge bg-accent-tint px-3 py-2 text-accent-tag-ink">
            Judge: {a.fusion.judge ?? 'the best free model left'}
          </span>
        </div>
      ) : (
        <p className="text-sm text-ink-500">
          Needs keys from at least two free providers (API keys).
        </p>
      )}
      <p className="text-xs text-ink-500">
        The “fusion” brain for sub-tasks and in Compare AIs. Every answer ends with the models used.
      </p>
    </Panel>
  );
}

function VoicePanel({
  a,
  set,
}: {
  a: Abilities;
  set: (k: Setting, v: boolean) => void;
}): React.JSX.Element {
  const hearing = (v: boolean): void => {
    if (!v) return set('voiceHearing', false);
    void confirmAction({
      title: 'Send your voice to a cloud engine?',
      body: 'When Whisper on this PC fails, your recorded words go to Groq, then OpenAI, to be written down (only engines with a key). Jarvis tells you each time he switches.',
      actionLabel: 'Allow',
      destructive: false,
    }).then((yes) => yes && set('voiceHearing', true));
  };
  return (
    <Panel title="Voice backup chain">
      <Title icon={<Mic size={16} aria-hidden />}>
        If a speech engine fails or hits its limit, the next one takes over instead of Jarvis going
        quiet, and you&apos;re told which one is in use.
      </Title>
      <BackupRow
        label="Speaking"
        items={['Kokoro on this PC', 'Edge voices', 'ElevenLabs', 'Windows voice']}
        now={a.voice.speaking}
        toggle={
          <Toggle
            label="Speaking backup"
            checked={a.settings.voiceSpeaking}
            onChange={(v) => set('voiceSpeaking', v)}
          />
        }
      />
      <BackupRow
        label="Hearing"
        items={['Whisper on this PC', 'Groq Whisper', 'OpenAI']}
        now={a.voice.hearing}
        toggle={
          <Toggle
            label="Cloud hearing backup"
            checked={a.settings.voiceHearing}
            onChange={hearing}
          />
        }
      />
      <p className="text-xs text-ink-500">
        Hearing backup sends your recorded voice to the cloud, so it is off until you switch it on.
        Speaking backup sends only Jarvis&apos;s reply text.
      </p>
    </Panel>
  );
}

function BackupRow({
  label,
  items,
  now,
  toggle,
}: {
  label: string;
  items: string[];
  now: string | null;
  toggle: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-100">{label}</span>
        {toggle}
      </div>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={clsx(
                'rounded-sm px-2 py-1',
                now === s
                  ? 'border border-accent-edge bg-accent-tint text-accent-tag-ink'
                  : 'bg-surface-2 text-ink-100',
              )}
            >
              {s}
            </span>
            {i < items.length - 1 && <ArrowRight size={12} aria-hidden className="text-ink-500" />}
          </li>
        ))}
      </ol>
      <span className="text-xs text-ink-300" role="status">
        In use now: {now ?? 'not used yet this session'}
      </span>
    </div>
  );
}

function Title({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className="flex items-start gap-2 text-sm text-ink-300">
      <span className="mt-0.5 text-accent-500">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
