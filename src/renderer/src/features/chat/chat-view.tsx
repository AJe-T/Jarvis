import { useEffect, useRef, useState } from 'react';
import {
  History,
  LayoutPanelLeft,
  MessageSquareText,
  Minimize2,
  PanelRight,
  Plus,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { LiveOrb, type OrbStep } from '../../components/jarvis/orb';
import { ChatMessage, ToolCards } from '../../components/jarvis/chat-message';
import { Composer } from '../../components/jarvis/composer';
import { IconButton } from '../../components/ui/button';
import { call } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';
import { useChatStore } from '../../stores/chat-store';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { useStageStore } from '../../stores/stage-store';
import { useUiStore } from '../../stores/ui-store';
import { StagePanelFrame } from '../stage/stage-panel';
import { ConversationList } from './conversation-list';
import { captionOf, STATUS_LINE } from './caption';
import { EmptyState } from './empty-state';

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = (): void => setMatches(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Corner readouts around the orb: clock, model, voice, spend. Decorative (the status bar carries the same). */
function Readouts({ compact }: { compact: boolean }): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  const lastModel = useSettingsStore((s) => s.lastModel);
  const defaultModel = useSetting('models.default');
  const model = lastModel ?? defaultModel;
  const voice = useSetting('voice.mode');
  const day = useSettingsStore((s) => s.dayCostUsd);
  const online = useUiStore((s) => s.online);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const cell = 'absolute hidden flex-col gap-0.5 font-code text-[11px] text-ink-500 md:flex';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-4">
      <div className={clsx(cell, 'top-0 left-0')}>
        <span className="hud-label">sys.clock</span>
        <span className="text-base text-ink-100 tabular">
          {now.toLocaleTimeString([], { hour12: false })}
        </span>
        <span>
          {now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })}
        </span>
      </div>
      <div className={clsx(cell, 'top-0 right-0 items-end', compact && 'hidden!')}>
        <span className="hud-label">uplink</span>
        <span className={online ? 'text-ok-400' : 'text-alarm-500'}>
          {online ? '■ link stable' : '■ link lost'}
        </span>
        <span>{model ?? '—'}</span>
      </div>
      <div className={clsx(cell, 'bottom-0 left-0')}>
        <span className="hud-label">audio.in</span>
        <span className="text-ink-300">{voice ?? 'off'}</span>
      </div>
      <div className={clsx(cell, 'right-0 bottom-0 items-end', compact && 'hidden!')}>
        <span className="hud-label">spend.today</span>
        <span className="text-ink-300 tabular">${day.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** The Core stage (§5.2): Jarvis's orb is the screen; replies appear under it as captions. */
function Stage({ steps, empty }: { steps: OrbStep[]; empty: boolean }): React.JSX.Element {
  const live = useChatStore((s) => s.live);
  const state = useAssistantStore((s) => s.state);
  const detail = useAssistantStore((s) => s.detail);
  const roomy = useMedia('(min-height: 760px)');
  const caption = live?.text ? captionOf(live.text) : '';
  const panel = useStageStore((s) => s.panel);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <Readouts compact={panel !== null} />
      <div
        className={clsx(
          'flex min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6 transition-[width] duration-500 ease-(--ease-standard)',
          panel ? 'w-2/5 max-md:hidden' : 'w-full',
        )}
      >
        <div
          className={clsx(
            'mesh flex flex-col items-center transition-transform duration-500 ease-(--ease-standard)',
            panel && 'scale-[0.8]',
          )}
        >
          <LiveOrb size={roomy ? 'xl' : 'lg'} steps={steps} />
          <p
            aria-hidden
            className={clsx(
              'hud-label mt-2 text-xs!',
              state === 'ERROR'
                ? 'text-alarm-500!'
                : state === 'AWAITING_CONFIRMATION'
                  ? 'text-lamp-400!'
                  : 'text-accent-300!',
            )}
          >
            {`[ ${state === 'ERROR' && detail ? detail : STATUS_LINE[state]} ]`}
          </p>
        </div>
        {caption ? (
          <p
            aria-hidden
            className="min-h-14 max-w-2xl text-center text-lg leading-relaxed text-ink-100"
          >
            {caption}
            <span className="stream-caret" />
          </p>
        ) : (
          empty && !panel && <EmptyState />
        )}
      </div>
      {panel && (
        // §5.2a: Jarvis moves aside; what Sir asked for fills the right of the stage.
        <div className="flex min-h-0 w-3/5 items-center py-6 pr-6 max-md:w-full max-md:pl-4">
          <StagePanelFrame panel={panel} />
        </div>
      )}
    </div>
  );
}

/** Opens a panel by hand (Jarvis opens the same ones with show_panel). */
function PanelMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const show = useStageStore((s) => s.show);
  const items = [
    {
      label: 'Pomodoro timer',
      run: () => show({ kind: 'pomodoro', minutes: 25, breakMinutes: 5 }),
    },
    { label: 'System status', run: () => show({ kind: 'status' }) },
    { label: 'AI usage & billing', run: () => show({ kind: 'usage' }) },
  ];
  return (
    <div className="relative">
      <IconButton label="Show a panel" active={open} onClick={() => setOpen(!open)}>
        <LayoutPanelLeft size={18} strokeWidth={1.75} aria-hidden />
      </IconButton>
      {open && (
        <ul role="menu" aria-label="Panels" className="popover absolute right-0 z-30 mt-1 w-52 p-1">
          {items.map((i) => (
            <li key={i.label}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  i.run();
                }}
                className="w-full rounded-sm px-2.5 py-1.5 text-left font-code text-xs text-ink-100 hover:bg-hover"
              >
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The conversation, secondary to the orb: a log beside it (an overlay sheet below 1200px). */
function CommsLog({ onClose }: { onClose(): void }): React.JSX.Element {
  const messages = useChatStore((s) => s.messages);
  const live = useChatStore((s) => s.live);
  const rewind = useChatStore((s) => s.rewind);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.text, live?.toolCalls.length]);

  return (
    <aside
      aria-label="Conversation"
      className="flex w-full flex-col border-l border-line bg-app max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:max-w-md max-lg:shadow-pop lg:w-100 lg:shrink-0 xl:w-115"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pr-2 pl-4">
        <h2 className="hud-label text-ink-300!">{'// comms log'}</h2>
        <span className="font-code text-[10px] text-ink-500 tabular">
          {String(messages.length).padStart(3, '0')}
        </span>
        <IconButton label="Close conversation log" className="ml-auto" onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-5 py-5" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 && !live && (
            <p className="py-8 text-center text-sm text-ink-500">No messages yet.</p>
          )}
          {messages.map((m, i) => (
            <ChatMessage
              key={m.id}
              message={m}
              onRewind={
                m.role === 'user' && !live
                  ? (resend) =>
                      void rewind(
                        messages.slice(0, i).filter((x) => x.role === 'user').length,
                        resend,
                      )
                  : undefined
              }
            />
          ))}
          {live && (
            // The words stream under the orb; the log shows the tools and a "replying" mark.
            <article
              className="border-l-2 border-accent-500 pl-3 text-ink-100"
              aria-label="Jarvis (replying)"
              aria-live="off"
            >
              {live.toolCalls.length > 0 && <ToolCards calls={live.toolCalls} />}
              <span className="typing-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </article>
          )}
        </div>
      </div>
    </aside>
  );
}

export function ChatView(): React.JSX.Element {
  const messages = useChatStore((s) => s.messages);
  const live = useChatStore((s) => s.live);
  const newConversation = useChatStore((s) => s.newConversation);
  const state = useAssistantStore((s) => s.state);
  const historyOpen = useUiStore((s) => s.historyOpen);
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen);
  const activityOpen = useUiStore((s) => s.activityOpen);
  const toggleActivity = useUiStore((s) => s.toggleActivity);
  const empty = messages.length === 0 && !live;
  const panel = useStageStore((s) => s.panel);
  const [logOpen, setLogOpen] = useState(!empty);
  // A panel needs the room: the log steps aside (the header button brings it back).
  useEffect(() => {
    if (panel) setLogOpen(false);
  }, [panel]);
  // A conversation starting (or being opened from history) brings the log out.
  useEffect(() => {
    if (!empty) setLogOpen(true);
  }, [empty]);
  const steps = (live?.toolCalls ?? []).map((c): OrbStep =>
    c.status === 'success'
      ? 'done'
      : c.status === 'error'
        ? 'error'
        : c.status === 'running' || c.status === 'awaiting'
          ? 'running'
          : 'pending',
  );

  return (
    <div className="relative flex min-w-0 flex-1">
      {historyOpen && <ConversationList onClose={() => setHistoryOpen(false)} />}
      <section aria-label="Jarvis core" className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line-subtle px-3">
          <IconButton
            label="Conversations"
            active={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <History size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton label="New conversation" onClick={newConversation}>
            <Plus size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <p aria-hidden className="hud-label mx-auto truncate">
            {`// core · ${STATUS_LINE[state]}`}
          </p>
          <PanelMenu />
          <IconButton label="Mini orb" onClick={() => void call('app:setMiniMode', { on: true })}>
            <Minimize2 size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton
            label={logOpen ? 'Hide conversation' : 'Show conversation'}
            active={logOpen}
            onClick={() => setLogOpen(!logOpen)}
          >
            <MessageSquareText size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton
            label={activityOpen ? 'Hide activity' : 'Show activity'}
            active={activityOpen}
            onClick={toggleActivity}
          >
            <PanelRight size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </header>
        <Stage steps={steps} empty={empty} />
        <div className="mx-auto w-full max-w-2xl shrink-0 box-content px-4 pb-4 md:px-6">
          <Composer />
        </div>
      </section>
      {logOpen && <CommsLog onClose={() => setLogOpen(false)} />}
    </div>
  );
}
