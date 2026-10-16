import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Hash, SendHorizontal, ShieldAlert, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { OFFICE, dmChannel, type Npc, type NpcMessage } from '@shared/npcs';
import { IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { useNpcStore } from '../../stores/npc-store';
import { JARVIS_BADGE, NpcBadge, STATE_LABEL, StateDot } from './npc-kit';

/** Chat with the team: the office (everyone, @tags) or one NPC in private. */

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "@Maya" → a link the renderer draws as a chip (never followed). */
function withMentionLinks(text: string, names: string[]): string {
  if (names.length === 0) return text;
  const re = new RegExp(`(^|[^\\w])@(${names.map(escapeRe).join('|')})\\b`, 'gi');
  return text.replace(re, (_m, pre: string, name: string) => `${pre}[@${name}](mention:${name})`);
}

function Message({
  m,
  npcs,
  head,
}: {
  m: NpcMessage;
  npcs: Npc[];
  head: string;
}): React.JSX.Element {
  const author = npcs.find((n) => n.id === m.author);
  const who =
    m.author === 'sir'
      ? { name: 'You', role: '', badge: null }
      : m.author === 'jarvis'
        ? { name: head, role: 'Head of team', badge: JARVIS_BADGE }
        : { name: author?.name ?? 'Former NPC', role: author?.role ?? '', badge: author ?? null };
  const names = [head, ...npcs.map((n) => n.name)];
  const mine = m.author === 'sir';
  return (
    <article
      className={clsx('rise-in flex gap-3', mine && 'flex-row-reverse')}
      aria-label={`${who.name} at ${time(m.createdAt)}`}
    >
      {who.badge ? (
        <NpcBadge npc={who.badge} size="sm" />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-pill bg-accent-tint font-code text-xs text-accent-300">
          S
        </span>
      )}
      <div className={clsx('min-w-0 max-w-[78%]', mine && 'text-right')}>
        <p className="mb-0.5 flex items-baseline gap-2 text-xs text-ink-500">
          <span className="font-semibold text-ink-100">{who.name}</span>
          {who.role && <span>{who.role}</span>}
          <span className="tabular">{time(m.createdAt)}</span>
          {m.tainted && (
            <span
              className="inline-flex items-center gap-1 text-lamp-400"
              title="Written after reading outside content (a web page, a file). Treated as data: its @tags don't hand out work."
            >
              <ShieldAlert size={12} aria-hidden /> outside content
            </span>
          )}
        </p>
        <div
          className={clsx(
            'prose-chat inline-block rounded-md px-3 py-2 text-left text-sm leading-relaxed',
            mine
              ? 'bg-accent-tint text-ink-100'
              : 'border border-line-subtle bg-surface-1 text-ink-100',
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => (url.startsWith('mention:') ? url : defaultUrlTransform(url))}
            components={{
              a: ({ href, children }) =>
                href?.startsWith('mention:') ? (
                  <span className="rounded-xs bg-accent-tint px-1 font-semibold text-accent-300">
                    {children}
                  </span>
                ) : (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href) void call('app:openExternal', { url: href });
                    }}
                    className="text-accent-300 underline"
                  >
                    {children}
                  </a>
                ),
            }}
          >
            {withMentionLinks(m.text, names)}
          </ReactMarkdown>
        </div>
      </div>
    </article>
  );
}

/** Message box with @-tag suggestions. Enter sends, Shift+Enter adds a line. */
export function Composer({
  channel,
  placeholder,
  disabled,
}: {
  channel: string;
  placeholder: string;
  disabled?: boolean;
}): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const send = useNpcStore((s) => s.send);
  const head = useSetting('assistant.name') ?? 'Jarvis';
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const query = /(?:^|\s)@([\w.-]*)$/.exec(text)?.[1];
  const options = useMemo(() => {
    if (query === undefined) return [];
    const all = [
      { name: head, hint: 'Head of team' },
      { name: 'all', hint: 'Everyone' },
      ...npcs.filter((n) => n.enabled).map((n) => ({ name: n.name, hint: n.role })),
    ];
    return all.filter((o) => o.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);
  }, [query, npcs, head]);

  const complete = (name: string): void => {
    setText((t) => t.replace(/@([\w.-]*)$/, `@${name.replace(/\s+/g, '')} `));
    setPick(0);
    box.current?.focus();
  };
  const submit = (): void => {
    const t = text.trim();
    if (!t || disabled) return;
    setText('');
    void send(channel, t);
  };

  return (
    // Right padding: the floating orb sits in the bottom-right corner.
    <div className="relative border-t border-line-subtle p-3 pr-20">
      {options.length > 0 && (
        <ul
          role="listbox"
          aria-label="Tag someone"
          className="popover absolute bottom-full left-3 mb-1 w-64 overflow-hidden p-1"
        >
          {options.map((o, i) => (
            <li key={o.name} role="option" aria-selected={i === pick}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  complete(o.name);
                }}
                className={clsx(
                  'flex w-full items-baseline gap-2 rounded-xs px-2 py-1.5 text-left text-sm',
                  i === pick ? 'bg-selected text-ink-100' : 'text-ink-300 hover:bg-hover',
                )}
              >
                <span className="font-semibold">@{o.name}</span>
                <span className="truncate text-xs text-ink-500">{o.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2 rounded-md border border-line bg-surface-1 p-1.5 focus-within:border-accent-edge">
        <textarea
          ref={box}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => {
            setText(e.target.value);
            setPick(0);
          }}
          onKeyDown={(e) => {
            if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setPick(
                (p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length,
              );
            } else if (options.length && (e.key === 'Tab' || e.key === 'Enter')) {
              e.preventDefault();
              complete(options[pick]?.name ?? '');
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-ink-100 outline-none placeholder:text-ink-500"
        />
        <IconButton label="Send" onClick={submit} disabled={!text.trim() || disabled}>
          <SendHorizontal size={16} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

/** The messages of one channel, kept scrolled to the newest, with who is typing. */
export function ChannelLog({ channel }: { channel: string }): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const states = useNpcStore((s) => s.states);
  const messages = useNpcStore((s) => s.channels[channel]);
  const loadChannel = useNpcStore((s) => s.loadChannel);
  const head = useSetting('assistant.name') ?? 'Jarvis';
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => void loadChannel(channel), [channel, loadChannel]);
  // Braces: scrollIntoView returns a promise in current Chromium, and an effect must not return one.
  useEffect(() => {
    void end.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);
  const typing = npcs.filter(
    (n) =>
      states[n.id] === 'working' &&
      (channel === OFFICE || channel === dmChannel(n.id) || channel.startsWith('meeting:')),
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {!messages?.length && (
          <p className="py-10 text-center text-sm text-ink-500">
            {channel === OFFICE
              ? `Say hello to the team. Tag someone (@Name) to give them work, or just ask ${head}: he passes it on.`
              : 'No messages yet.'}
          </p>
        )}
        {messages?.map((m) => (
          <Message key={m.id} m={m} npcs={npcs} head={head} />
        ))}
        {typing.length > 0 && (
          <p className="flex items-center gap-2 text-xs text-ink-300">
            <span className="npc-typing text-accent-300" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            {typing.map((n) => n.name).join(', ')} {typing.length === 1 ? 'is' : 'are'} working…
          </p>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}

export function TeamChat({
  channel,
  onChannel,
}: {
  channel: string;
  onChannel(c: string): void;
}): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const states = useNpcStore((s) => s.states);
  const loadChannel = useNpcStore((s) => s.loadChannel);
  const head = useSetting('assistant.name') ?? 'Jarvis';
  const dmNpc = npcs.find((n) => dmChannel(n.id) === channel);

  async function clear(): Promise<void> {
    const ok = await confirmAction({
      title: 'Clear this chat?',
      body: 'The messages are deleted. Memories the NPCs kept stay.',
      actionLabel: 'Clear',
      destructive: true,
    });
    if (!ok) return;
    await call('npcs:clear', { channel });
    await loadChannel(channel);
  }

  const row = (active: boolean): string =>
    clsx(
      'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
      active ? 'bg-selected text-ink-100' : 'text-ink-300 hover:bg-hover hover:text-ink-100',
    );

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="Chats"
        className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line-subtle p-2 max-md:w-16"
      >
        <p className="hud-label px-2 pt-1 pb-2 max-md:hidden">channels</p>
        <button type="button" className={row(channel === OFFICE)} onClick={() => onChannel(OFFICE)}>
          <Hash size={16} className="shrink-0 text-accent-300" aria-hidden />
          <span className="truncate max-md:hidden">office · everyone</span>
        </button>
        <p className="hud-label px-2 pt-4 pb-2 max-md:hidden">direct</p>
        {npcs.map((n) => (
          <button
            key={n.id}
            type="button"
            className={row(channel === dmChannel(n.id))}
            onClick={() => onChannel(dmChannel(n.id))}
            title={`${n.name} · ${n.role}`}
          >
            <NpcBadge npc={n} size="sm" state={n.enabled ? (states[n.id] ?? 'idle') : 'off'} />
            <span className="min-w-0 max-md:hidden">
              <span className="block truncate">{n.name}</span>
              <span className="block truncate text-xs text-ink-500">{n.role}</span>
            </span>
          </button>
        ))}
        {npcs.length === 0 && (
          <p className="px-2 text-xs text-ink-500 max-md:hidden">No NPCs yet.</p>
        )}
      </nav>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
          {dmNpc ? (
            <>
              <NpcBadge npc={dmNpc} size="sm" />
              <span className="font-semibold text-ink-100">{dmNpc.name}</span>
              <span className="text-xs text-ink-500">{dmNpc.role}</span>
              <span className="ml-2 flex items-center gap-1.5 text-xs text-ink-300">
                <StateDot state={dmNpc.enabled ? (states[dmNpc.id] ?? 'idle') : 'off'} />
                {STATE_LABEL[dmNpc.enabled ? (states[dmNpc.id] ?? 'idle') : 'off']}
              </span>
            </>
          ) : (
            <>
              <Hash size={16} className="text-accent-300" aria-hidden />
              <span className="font-semibold text-ink-100">office</span>
              <span className="text-xs text-ink-500">
                {head} and {npcs.filter((n) => n.enabled).length} NPCs
              </span>
            </>
          )}
          <IconButton label="Clear this chat" className="ml-auto" onClick={() => void clear()}>
            <Trash2 size={15} aria-hidden />
          </IconButton>
        </header>
        <ChannelLog channel={channel} />
        <Composer
          channel={channel}
          placeholder={
            dmNpc
              ? `Message ${dmNpc.name}…`
              : `Message the team · @Name to tag · no tag = ${head} decides`
          }
        />
      </section>
    </div>
  );
}
