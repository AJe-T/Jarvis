import { Fragment } from 'react';
import clsx from 'clsx';
import {
  AudioLines,
  BrainCircuit,
  Ear,
  Keyboard,
  Mic,
  MicOff,
  Radio,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { STT_ENGINES, TTS_ENGINES } from '@shared/speech-engines';
import type { AssistantState, VoiceMode } from '@shared/types';
import { useAssistantStore } from '../../stores/assistant-store';
import { useDraftSetting } from '../../stores/settings-store';

export interface ModeInfo {
  value: VoiceMode;
  label: string;
  hint: string;
}

const MODE_ICONS: Record<VoiceMode, LucideIcon> = {
  off: MicOff,
  ptt: Keyboard,
  wake: Ear,
  ambient: Radio,
};

/** Voice mode as four tiles; the chosen one glows and its explanation shows underneath. */
export function ModeTiles({
  modes,
  mode,
  onPick,
}: {
  modes: ModeInfo[];
  mode: VoiceMode;
  onPick(m: VoiceMode): void;
}): React.JSX.Element {
  const chosen = modes.find((m) => m.value === mode);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Voice mode"
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
      >
        {modes.map((m) => {
          const Icon = MODE_ICONS[m.value];
          const on = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(m.value)}
              className={clsx(
                'group relative flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm transition-[border-color,background-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent-500',
                on
                  ? 'border-accent-edge bg-selected text-ink-100 shadow-[0_0_18px_var(--accent-glow)]'
                  : 'border-line text-ink-300 hover:border-ink-500 hover:text-ink-100',
              )}
            >
              <span
                className={clsx(
                  'relative grid size-12 place-items-center rounded-full border',
                  on ? 'mic-live border-accent-500 text-accent-300' : 'border-line',
                )}
              >
                <Icon size={22} aria-hidden />
              </span>
              <span className="font-medium">{m.label}</span>
            </button>
          );
        })}
      </div>
      {chosen && <p className="text-sm text-ink-500">{chosen.hint}</p>}
    </div>
  );
}

interface Stage {
  id: string;
  icon: LucideIcon;
  title: string;
  engine: string;
  /** The assistant states during which this stage is the one working. */
  active: AssistantState[];
  anchor: string;
}

const WAKE_ENGINE: Record<string, string> = {
  picovoice: 'Porcupine',
  openwakeword: 'openWakeWord',
  name: 'Whisper, by name',
  personal: 'Your own voice',
};

const short = (title: string | undefined): string => (title ?? '').replace(/\s*\(.*\)$/, '');

const jump = (anchor: string): void =>
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/**
 * The voice pipeline as a live diagram: microphone → wake → hearing → thinking → speaking, each
 * stage named with the engine chosen for it. The stage at work right now lights up, and the
 * wires pulse while a turn moves through them. Click a stage to jump to its settings.
 */
export function VoiceFlow({ mode }: { mode: VoiceMode }): React.JSX.Element {
  const state = useAssistantStore((s) => s.state);
  const micLevel = useAssistantStore((s) => s.micLevel);
  const wake = useDraftSetting('voice.wake.provider') ?? 'name';
  const stt = useDraftSetting('voice.stt.provider') ?? 'deepgram';
  const tts = useDraftSetting('voice.tts.provider') ?? 'edge';
  const voice = useDraftSetting('voice.tts.voice') ?? '';
  const brain = useDraftSetting('llm.provider') ?? 'api';
  const off = mode === 'off';

  const starter: Pick<Stage, 'icon' | 'title' | 'engine'> =
    mode === 'ptt'
      ? { icon: Keyboard, title: 'Press', engine: 'Ctrl+Alt+Space' }
      : mode === 'ambient'
        ? { icon: Radio, title: 'Always on', engine: 'Whisper on this PC' }
        : { icon: Ear, title: 'Wake word', engine: WAKE_ENGINE[wake] ?? wake };
  const stages: Stage[] = [
    {
      id: 'mic',
      icon: Mic,
      title: 'Microphone',
      engine: 'Windows input',
      active: [],
      anchor: 'voice-mic',
    },
    { id: 'wake', ...starter, active: ['IDLE'], anchor: 'voice-engines' },
    {
      id: 'hear',
      icon: AudioLines,
      title: 'Hearing',
      engine: short(STT_ENGINES.find((e) => e.id === stt)?.title) || stt,
      active: ['LISTENING'],
      anchor: 'voice-engines',
    },
    {
      id: 'think',
      icon: BrainCircuit,
      title: 'Thinking',
      engine:
        brain === 'subscription'
          ? 'Claude (your plan)'
          : brain === 'api'
            ? 'Claude'
            : brain === 'local'
              ? 'Local model'
              : 'Cloud AI',
      active: ['THINKING'],
      anchor: '',
    },
    {
      id: 'speak',
      icon: Volume2,
      title: 'Speaking',
      engine: `${short(TTS_ENGINES.find((e) => e.id === tts)?.title) || tts}${voice && tts === 'edge' ? ` · ${voice.replace(/^[a-z]{2}-[A-Z]{2}-|Neural$/g, '')}` : ''}`,
      active: ['SPEAKING'],
      anchor: 'voice-output',
    },
  ];
  const working = off ? -1 : stages.findIndex((s) => s.active.includes(state));
  // Waiting for the name (IDLE) is only "at work" when a hands-free mode is on.
  const lit = working === 1 && mode === 'ptt' ? -1 : working;

  return (
    <div
      className={clsx(
        'rounded-lg border border-line bg-surface-1 p-4 transition-opacity',
        off && 'opacity-50',
      )}
      aria-label="How your voice travels"
    >
      <ol className="flex items-start">
        {stages.map((s, i) => {
          const Icon = s.icon;
          const on = i === lit;
          const passed = lit > 0 && i < lit;
          const ring = s.id === 'mic' && !off ? Math.min(1, micLevel * 6) : 0;
          return (
            <Fragment key={s.id}>
              {i > 0 && (
                <li
                  aria-hidden
                  className="mt-7 h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-line"
                >
                  <div className={clsx('size-full', (on || passed) && 'flow-wire')} />
                </li>
              )}
              <li className="flex w-24 shrink-0 flex-col items-center gap-1.5 text-center">
                <button
                  type="button"
                  disabled={!s.anchor}
                  onClick={() => jump(s.anchor)}
                  aria-label={`${s.title}: ${s.engine}${on ? ' (working now)' : ''}`}
                  className={clsx(
                    'relative grid size-14 place-items-center rounded-full border-2 transition-[border-color,box-shadow,color] duration-200 enabled:hover:border-ink-500 focus-visible:outline-2 focus-visible:outline-accent-500',
                    on
                      ? 'mic-live border-accent-600 text-accent-300 shadow-[0_0_22px_var(--accent-glow)]'
                      : passed
                        ? 'border-accent-edge text-accent-300'
                        : 'border-line text-ink-300',
                  )}
                  style={
                    ring > 0
                      ? { boxShadow: `0 0 0 ${(ring * 8).toFixed(1)}px var(--accent-glow)` }
                      : undefined
                  }
                >
                  <Icon size={22} aria-hidden />
                </button>
                <span className="text-xs font-semibold text-ink-100">{s.title}</span>
                <span className="line-clamp-2 text-[11px] leading-tight text-ink-500">
                  {s.engine}
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-xs text-ink-500" aria-live="polite">
        {off
          ? 'Voice is off. Pick a mode above to start.'
          : lit >= 0
            ? `Now: ${stages[lit]?.title.toLowerCase()} (${stages[lit]?.engine}).`
            : 'Ready. Click a stage to change its engine.'}
      </p>
    </div>
  );
}
