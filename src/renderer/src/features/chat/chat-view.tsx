import { useCallback, useEffect, useRef, useState } from 'react';
import { History, MessageSquareText, Minimize2, PanelRight, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { LiveOrb, type OrbStep } from '../../components/jarvis/orb';
import { ChatMessage, ToolCards } from '../../components/jarvis/chat-message';
import { Composer } from '../../components/jarvis/composer';
import { IconButton } from '../../components/ui/button';
import { Slash } from '../../components/ui/slash';
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
import { ContextMeter } from './context-meter';
import { HelpButton } from '../../help/help-button';
import { LogResizer, saved as savedLogWidth, useLogWidth } from './log-resizer';
import {
  nextOrder,
  panelsToClose,
  panelWidth,
  RAIL_STUB,
  STAGE_MIN,
  STAGE_MIN_WITH_APP,
  type PanelId,
} from './panel-fit';
import { AppsBar } from '../stage/apps-bar';
import { lastArtifact } from './reply-outputs';

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

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

/**
 * Sidebar, conversations, comms log, activity and an app on the stage share one row. Opening one
 * that doesn't fit closes the ones opened longest ago (the sidebar collapses first); the sidebar
 * comes back by itself once there's room again, unless Sir hid it.
 */
function usePanelFit(logOpen: boolean, closeLog: () => void): void {
  const win = useWindowWidth();
  const historyOpen = useUiStore((s) => s.historyOpen);
  const activityOpen = useUiStore((s) => s.activityOpen);
  const railHidden = useUiStore((s) => s.railHidden);
  const appOpen = useStageStore((s) => s.panel !== null);
  const order = useRef<PanelId[]>([]);
  /** The sidebar was tucked away to make room (an app panel tucks it too; that one isn't ours). */
  const tuckedByFit = useRef(false);
  // Other views have no side panels: the sidebar Jarvis tucked away comes back when Core closes.
  useEffect(() => () => useUiStore.getState().autoRail(false), []);
  useEffect(() => {
    const ui = useUiStore.getState();
    // At start the sidebar counts as the oldest; shown again with Ctrl+B it is the newest.
    order.current = nextOrder(order.current, {
      rail: !railHidden,
      history: historyOpen,
      activity: activityOpen,
      log: logOpen,
    });
    const width = (id: PanelId): number => panelWidth(id, win, savedLogWidth());
    const room = win - RAIL_STUB;
    const stageMin = appOpen ? STAGE_MIN_WITH_APP : STAGE_MIN;
    const open = order.current;
    const close: Record<PanelId, () => void> = {
      rail: () => {
        tuckedByFit.current = true;
        ui.autoRail(true);
      },
      history: () => ui.setHistoryOpen(false),
      activity: () => useUiStore.setState({ activityOpen: false }),
      log: closeLog,
    };
    const closing = panelsToClose(open, room, stageMin, width);
    for (const id of closing) close[id]();
    const left = open.filter((id) => !closing.includes(id));
    const used = left.reduce((sum, id) => sum + width(id), 0);
    if (!ui.railAuto) tuckedByFit.current = false;
    if (tuckedByFit.current && room - used - width('rail') >= stageMin) {
      tuckedByFit.current = false;
      ui.autoRail(false);
    }
  }, [win, historyOpen, activityOpen, logOpen, railHidden, appOpen, closeLog]);
}

const VOICE_WORDS = {
  off: 'off',
  ptt: 'press to talk',
  wake: 'wake word',
  ambient: 'always listening',
} as const;

/** Corner readouts around the orb: clock, model, voice, spend (the app has no status bar). */
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
  const cell = 'absolute hidden flex-col gap-0.5 font-code text-2xs text-ink-500 md:flex';
  return (
    <div role="group" aria-label="Readouts" className="pointer-events-none absolute inset-4">
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
        <span className="text-ink-300">{VOICE_WORDS[voice ?? 'off']}</span>
      </div>
      <div className={clsx(cell, 'right-0 bottom-0 items-end', compact && 'hidden!')}>
        <span className="hud-label">spend.today</span>
        <span className="text-ink-300 tabular">${day.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** The Core stage (§5.2): Jarvis's orb is the screen; replies appear under it as captions. */
/**
 * §5.2: with the log closed the orb is the whole interface: click it (or the push-to-talk key) to
 * speak; start typing anywhere and the log opens with your words in its box.
 */
function TalkOrb({
  steps,
  big,
  onChat,
}: {
  steps: OrbStep[];
  big: boolean;
  onChat(): void;
}): React.JSX.Element {
  const state = useAssistantStore((s) => s.state);
  const detail = useAssistantStore((s) => s.detail);
  const voiceMode = useSetting('voice.mode');
  const listening = state === 'LISTENING' && detail !== 'compose';
  const voiceOff = voiceMode === 'off' || voiceMode === undefined;
  return (
    <button
      type="button"
      aria-label={voiceOff ? 'Open the chat' : listening ? 'Stop listening' : 'Speak to Jarvis'}
      title={
        voiceOff ? 'Voice is off: type instead' : listening ? 'Stop listening' : 'Click to talk'
      }
      onClick={() =>
        voiceOff ? onChat() : void call('voice:mic', { action: listening ? 'stop' : 'start' })
      }
      className="rounded-pill transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
    >
      <LiveOrb size={big ? 'xl' : 'lg'} steps={steps} />
    </button>
  );
}

function Stage({
  steps,
  empty,
  logOpen,
  onChat,
}: {
  steps: OrbStep[];
  empty: boolean;
  logOpen: boolean;
  onChat(): void;
}): React.JSX.Element {
  const live = useChatStore((s) => s.live);
  const pttKey = useSetting('hotkeys.ptt') ?? 'Ctrl+Alt+Space';
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
          <TalkOrb steps={steps} big={roomy} onChat={onChat} />
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
          {!logOpen && !panel && (
            <p className="mt-1 text-center text-xs text-ink-500">
              Click the orb or press <kbd className="font-code text-ink-300">{pttKey}</kbd> to talk
              · start typing to chat
            </p>
          )}
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

/** The conversation, secondary to the orb: a log beside it (an overlay sheet below 1200px). */
function CommsLog({ onClose }: { onClose(): void }): React.JSX.Element {
  const messages = useChatStore((s) => s.messages);
  const live = useChatStore((s) => s.live);
  const rewind = useChatStore((s) => s.rewind);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useLogWidth();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.text, live?.toolCalls.length]);

  return (
    <aside
      aria-label="Conversation"
      style={width ? ({ '--log-w': `${width}px` } as React.CSSProperties) : undefined}
      className={clsx(
        // Below 1200px a sheet that starts under the core header, so its toggles stay reachable.
        'relative flex w-full min-w-0 flex-col border-l border-line bg-app max-lg:absolute max-lg:top-12 max-lg:bottom-0 max-lg:right-0 max-lg:z-20 max-lg:max-w-md max-lg:shadow-pop lg:max-w-[calc(100%-360px)] lg:shrink-0',
        width ? 'lg:w-(--log-w)' : 'lg:w-100 xl:w-115',
      )}
    >
      <LogResizer width={width} onWidth={setWidth} />
      <header
        data-titlebar
        className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pr-2 pl-4"
      >
        <h2 className="hud-label text-ink-300!">
          <Slash />
          comms log
        </h2>
        <span className="font-code text-3xs text-ink-500 tabular">
          {String(messages.length).padStart(3, '0')}
        </span>
        <div className="ml-auto">
          <ContextMeter />
        </div>
        <IconButton label="Close conversation log" onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </header>
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4">
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
      {/* §5.2: typing lives with the conversation; the stage is the orb's. */}
      <div className="shrink-0 border-t border-line-subtle p-3">
        <Composer />
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
  const closeLog = useCallback(() => setLogOpen(false), []);
  // A panel needs the room: the log steps aside (the header button brings it back).
  useEffect(() => {
    if (panel) setLogOpen(false);
  }, [panel]);
  usePanelFit(logOpen, closeLog);
  // A finished reply with a page, drawing or diagram shows it beside the orb (§5.2a).
  const wasLive = useRef(false);
  useEffect(() => {
    const ended = wasLive.current && !live;
    wasLive.current = !!live;
    if (!ended) return;
    const last = messages.at(-1);
    const art = last?.role === 'assistant' ? lastArtifact(last.text) : null;
    if (art) useStageStore.getState().show({ kind: 'artifact', ...art });
  }, [live, messages]);
  // A conversation starting (or being opened from history) brings the log out.
  useEffect(() => {
    if (!empty) setLogOpen(true);
  }, [empty]);
  // Orb only: start typing anywhere and the log opens with that letter in the box.
  useEffect(() => {
    if (logOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      const typing = el?.closest('input, textarea, select, [contenteditable="true"]');
      if (typing || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      e.preventDefault();
      useChatStore.setState({ draft: e.key });
      setLogOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [logOpen]);
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
    <div data-log-row className="relative flex min-w-0 flex-1">
      {historyOpen && <ConversationList onClose={() => setHistoryOpen(false)} />}
      <section aria-label="Jarvis core" className="relative flex min-w-0 flex-1 flex-col">
        <header
          data-titlebar
          className="flex h-12 shrink-0 items-center gap-1 border-b border-line-subtle px-3"
        >
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
          <HelpButton topic="core" />
          <p aria-hidden className="hud-label mx-auto truncate">
            <Slash />
            {`core · ${STATUS_LINE[state]}`}
          </p>
          <AppsBar />
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
        <Stage steps={steps} empty={empty} logOpen={logOpen} onChat={() => setLogOpen(true)} />
      </section>
      {logOpen && <CommsLog onClose={() => setLogOpen(false)} />}
    </div>
  );
}
