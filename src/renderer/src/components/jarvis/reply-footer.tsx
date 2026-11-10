import { useState } from 'react';
import { Check, Copy, Square, Volume2 } from 'lucide-react';
import type { UiMessage } from '@shared/types';
import { call } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';

const COPIED_MS = 1500;
const ICON =
  'rounded-sm p-1 text-ink-500 hover:text-ink-100 focus-visible:text-ink-100 focus-visible:outline-none';

/** "1.2 s to first word · 6.4 s" (4.8): how long this reply took. */
export function timingLabel(t: NonNullable<UiMessage['timing']>): string {
  const s = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return t.totalMs - t.firstWordMs < 300
    ? s(t.totalMs)
    : `${s(t.firstWordMs)} to first word · ${s(t.totalMs)}`;
}

// ponytail: a word list, not a date parser; it only decides whether the calendar chip is worth showing.
const MENTIONS_A_TIME =
  /\b(today|tonight|tomorrow|(mon|tues|wednes|thurs|fri|satur|sun)day|next week|\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}:\d{2}|\d{1,2}(st|nd|rd|th)?\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;

/**
 * Follow-up chips (4.5) under the latest reply: fixed, so they cost nothing. "Do it" only when the
 * reply ends with a question (an offer or a plan waiting for a yes). The "send to" chips hand the
 * reply to Tasks, Calendar (only when it names a time) and Spaces through Jarvis's own tools.
 */
export function followUps(text: string): Array<{ label: string; send: string }> {
  const chips = [
    { label: 'More detail', send: 'Tell me more about that, in more detail.' },
    { label: 'Save to memory', send: 'Save the key points of that to memory.' },
    { label: 'Add to tasks', send: 'Add the action items from that to my tasks.' },
    ...(MENTIONS_A_TIME.test(text)
      ? [{ label: 'Add to calendar', send: 'Put that on my calendar.' }]
      : []),
    {
      label: 'Save to Space',
      send: 'Save that as a page in the Space that fits best, and tell me which one.',
    },
  ];
  return /\?\s*$/.test(text.trim()) ? [{ label: 'Do it', send: 'Yes, do it.' }, ...chips] : chips;
}

/**
 * Under each reply: Copy, Read aloud (4.4, through Jarvis's voice; again to stop) and how long it
 * took (4.8). The latest reply also offers follow-up chips. Actions show on hover; timing always.
 */
export function ReplyFooter({
  message,
  onFollowUp,
}: {
  message: UiMessage;
  onFollowUp?: ((text: string) => void) | undefined;
}): React.JSX.Element | null {
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState(false);
  const speaking = useAssistantStore((s) => s.state === 'SPEAKING');
  const text = message.text.trim();
  if (!text && !message.timing) return null;
  const isReading = reading && speaking;

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {text && (
          <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              aria-label={copied ? 'Copied' : 'Copy reply'}
              title="Copy reply"
              className={ICON}
              onClick={() => {
                void navigator.clipboard.writeText(message.text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), COPIED_MS);
                });
              }}
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            </button>
            <button
              type="button"
              aria-label={isReading ? 'Stop reading' : 'Read aloud'}
              title={isReading ? 'Stop reading' : 'Read aloud'}
              className={ICON}
              onClick={() => {
                if (isReading) {
                  setReading(false);
                  void call('voice:speak', { action: 'stop' });
                } else {
                  setReading(true);
                  void call('voice:speak', { action: 'start', text: message.text });
                }
              }}
            >
              {isReading ? <Square size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
            </button>
          </div>
        )}
        {message.timing && (
          <span className="ml-auto font-code text-3xs text-ink-500 tabular" title="Reply time">
            {timingLabel(message.timing)}
          </span>
        )}
      </div>
      {onFollowUp && text && (
        <div className="flex flex-wrap gap-1.5" aria-label="Follow-ups">
          {followUps(text).map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => onFollowUp(c.send)}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-300 hover:border-accent-edge hover:text-ink-100 focus-visible:border-accent-edge focus-visible:outline-none"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
