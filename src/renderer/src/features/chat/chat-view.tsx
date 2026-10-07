import { useEffect, useRef } from 'react';
import { History, Minimize2, PanelRight, Plus } from 'lucide-react';
import { LiveOrb, type OrbStep } from '../../components/jarvis/orb';
import { ChatMessage, Markdown, ToolCards } from '../../components/jarvis/chat-message';
import { Composer } from '../../components/jarvis/composer';
import { IconButton } from '../../components/ui/button';
import { call } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';
import { useChatStore } from '../../stores/chat-store';
import { useUiStore } from '../../stores/ui-store';
import { ConversationList } from './conversation-list';
import { EmptyState } from './empty-state';

const STATUS_LINE: Record<string, string> = {
  IDLE: 'Ready',
  LISTENING: 'Listening…',
  THINKING: 'Thinking…',
  ACTING: 'Working…',
  AWAITING_CONFIRMATION: 'Waiting for your decision',
  SPEAKING: 'Speaking…',
  ERROR: 'Something went wrong',
  SLEEP: 'Asleep',
};

function stripSpokenTags(text: string): string {
  return text.replace(/<\/?spoken>/g, '');
}

export function ChatView(): React.JSX.Element {
  const messages = useChatStore((s) => s.messages);
  const live = useChatStore((s) => s.live);
  const rewind = useChatStore((s) => s.rewind);
  const newConversation = useChatStore((s) => s.newConversation);
  const state = useAssistantStore((s) => s.state);
  const detail = useAssistantStore((s) => s.detail);
  const historyOpen = useUiStore((s) => s.historyOpen);
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen);
  const activityOpen = useUiStore((s) => s.activityOpen);
  const toggleActivity = useUiStore((s) => s.toggleActivity);
  const scrollRef = useRef<HTMLDivElement>(null);
  const empty = messages.length === 0 && !live;
  const steps = (live?.toolCalls ?? []).map((c): OrbStep =>
    c.status === 'success'
      ? 'done'
      : c.status === 'error'
        ? 'error'
        : c.status === 'running' || c.status === 'awaiting'
          ? 'running'
          : 'pending',
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.text, live?.toolCalls.length]);

  return (
    <div className="relative flex min-w-0 flex-1">
      {historyOpen && <ConversationList onClose={() => setHistoryOpen(false)} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
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
          <div
            className="mx-auto flex items-center gap-2 transition-opacity duration-[320ms]"
            style={{ opacity: empty ? 0 : 1 }}
            aria-hidden={empty}
          >
            <LiveOrb size="sm" steps={steps} />
            <span className="text-sm font-medium text-ink-300">
              {state === 'ERROR' && detail ? detail : STATUS_LINE[state]}
            </span>
          </div>
          <IconButton label="Mini orb" onClick={() => void call('app:setMiniMode', { on: true })}>
            <Minimize2 size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton
            label={activityOpen ? 'Hide activity' : 'Show activity'}
            active={activityOpen}
            onClick={toggleActivity}
          >
            <PanelRight size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </header>

        {empty ? (
          <EmptyState />
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6">
            <div
              className="mx-auto flex max-w-3xl flex-col gap-6 py-6"
              aria-live="polite"
              aria-relevant="additions"
            >
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
                <article className="text-ink-100" aria-label="Jarvis (replying)" aria-live="off">
                  {live.toolCalls.length > 0 && <ToolCards calls={live.toolCalls} />}
                  {live.text && <Markdown text={stripSpokenTags(live.text)} />}
                  <span className="stream-caret" aria-hidden />
                </article>
              )}
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-3xl shrink-0 box-content px-4 pb-4 md:px-6">
          <Composer />
        </div>
      </div>
    </div>
  );
}
