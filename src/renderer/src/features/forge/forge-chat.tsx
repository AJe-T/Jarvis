import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { Hammer, SendHorizontal, ShieldAlert } from 'lucide-react';
import { useVoiceSend, VoiceSendButton } from '../../components/jarvis/voice-send';
import { IconButton } from '../../components/ui/button';
import { call } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { useForgeStore, type ForgeMessage, type ForgeRunView } from '../../stores/forge-store';
import { FirstRun } from './forge-first-run';

/**
 * F9: the Forge chat. Sir talks to the Forge desk (it agrees goals, starts and follows builds, ships);
 * run steps appear here as they happen, and the card on top follows the current run live.
 */

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const WORKING = new Set(['preparing', 'installing', 'building', 'checking']);
const STATE_LABEL: Record<string, string> = {
  preparing: 'Preparing',
  installing: 'Installing (npm ci)',
  building: 'Claude is building',
  checking: 'Running the checks',
  passed: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Markdown from the desk or Sir; links open in the browser, never in the app. */
function Text({ text }: { text: string }): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href && /^https?:\/\//i.test(href)) void call('app:openExternal', { url: href });
            }}
            className="text-accent-300 underline"
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function Tainted(): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 text-lamp-400"
      title="Holds outside content (Claude's summary of repository code, check output, a web page). Treated as data, never as orders."
    >
      <ShieldAlert size={12} aria-hidden /> outside content
    </span>
  );
}

function Message({ m, head }: { m: ForgeMessage; head: string }): React.JSX.Element {
  if (m.role === 'event')
    return (
      <article
        aria-label={`Forge run at ${time(m.at)}`}
        className="rise-in flex items-start gap-2 px-1 text-xs text-ink-500"
      >
        <span className="tabular shrink-0">{time(m.at)}</span>
        <div className="min-w-0 whitespace-pre-wrap text-ink-300">
          {m.text}
          {m.tainted && (
            <span className="ml-2">
              <Tainted />
            </span>
          )}
        </div>
      </article>
    );
  const mine = m.role === 'sir';
  return (
    <article
      aria-label={`${mine ? 'You' : 'Forge'} at ${time(m.at)}`}
      className={clsx('rise-in flex gap-3', mine && 'flex-row-reverse')}
    >
      <span
        className={clsx(
          'grid size-7 shrink-0 place-items-center rounded-pill font-code text-xs',
          mine ? 'bg-accent-tint text-accent-300' : 'bg-surface-2 text-lamp-400',
        )}
        aria-hidden
      >
        {mine ? 'S' : <Hammer size={14} />}
      </span>
      <div className={clsx('min-w-0 max-w-[80%]', mine && 'text-right')}>
        <p className="mb-0.5 flex items-baseline gap-2 text-xs text-ink-500">
          <span className="font-semibold text-ink-100">{mine ? 'You' : `${head}'s Forge`}</span>
          <span className="tabular">{time(m.at)}</span>
          {m.tainted && <Tainted />}
        </p>
        <div
          className={clsx(
            'prose-chat inline-block rounded-md px-3 py-2 text-left text-sm leading-relaxed',
            mine
              ? 'bg-accent-tint text-ink-100'
              : 'border border-line-subtle bg-surface-1 text-ink-100',
          )}
        >
          <Text text={m.text} />
        </div>
      </div>
    </article>
  );
}

/** The current run, live: state, goal, the last few steps. */
export function LiveRun({ run }: { run: ForgeRunView }): React.JSX.Element {
  const working = WORKING.has(run.state) || run.ship?.state === 'running';
  const label = run.ship?.state === 'running' ? 'Shipping' : (STATE_LABEL[run.state] ?? run.state);
  return (
    <section
      aria-label="Current Forge run"
      className={clsx('card flex flex-col gap-1.5 p-3', working && 'border-accent-500')}
    >
      <p className="flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className={clsx(
            'size-2 shrink-0 rounded-pill',
            working
              ? 'animate-pulse bg-accent-300'
              : run.state === 'passed'
                ? 'bg-ok-400'
                : 'bg-ink-500',
          )}
        />
        <span role="status" className="font-semibold text-ink-100">
          {label}
        </span>
        <span className="min-w-0 truncate text-ink-300">
          {run.kind === 'tool' ? `Tool "${run.tool ?? ''}": ` : ''}
          {run.goal}
        </span>
      </p>
      {run.log.length > 0 && (
        <ul className="ml-4 list-disc text-xs text-ink-500">
          {run.log.slice(-3).map((l, i) => (
            <li key={i} className="truncate">
              {l}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ForgeChat(): React.JSX.Element {
  const { messages, loaded, live, sending, load, send } = useForgeStore();
  const head = useSetting('assistant.name') || 'Jarvis';
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const submitText = async (raw: string): Promise<void> => {
    const t = raw.trim();
    if (!t || sending) return;
    setText('');
    if (!(await send(t))) setText(t);
  };
  const submit = (): Promise<void> => submitText(text);
  const voice = useVoiceSend({ text, setText, onSend: (t) => void submitText(t) });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <FirstRun />
      {live && <LiveRun run={live} />}
      <div
        role="log"
        aria-label="Forge chat"
        aria-live="polite"
        className="flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto pr-1"
      >
        {loaded && messages.length === 0 && (
          <div className="m-auto max-w-md text-center text-sm text-ink-500">
            <p className="text-ink-300">Tell Forge what {head} should learn.</p>
            <p className="mt-1">
              For example: &quot;learn to convert currencies&quot;, or &quot;add a dark/light switch
              to Settings, like the one in VS Code&quot;. Forge agrees the goal with you, asks
              before it builds and before it ships, and never installs by itself. It can&apos;t see
              your personal memory, Spaces or chats with {head}.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} head={head} />
        ))}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="Message to Forge"
          value={text}
          rows={2}
          maxLength={8000}
          placeholder={
            voice.live
              ? 'Listening… speak, and it sends when you pause'
              : 'What should Forge build? (Enter sends, Shift+Enter for a new line, or tap the mic)'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="min-h-[3rem] flex-1 resize-y rounded-sm border border-line bg-surface-1 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-accent-edge"
        />
        <VoiceSendButton live={voice.live} onClick={voice.toggle} disabled={sending} />
        <IconButton label="Send" type="submit" disabled={!text.trim() || sending}>
          <SendHorizontal size={16} aria-hidden />
        </IconButton>
      </form>
    </div>
  );
}
