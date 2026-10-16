import { useEffect, useState } from 'react';
import { Play, Square, Users } from 'lucide-react';
import clsx from 'clsx';
import { meetingChannel, type NpcMeeting } from '@shared/npcs';
import { Button } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useNpcStore } from '../../stores/npc-store';
import { useUiStore } from '../../stores/ui-store';
import { NPC_HEX, NpcBadge } from './npc-kit';
import { ChannelLog, Composer } from './team-chat';

/**
 * Meeting room (ideas from Claw3D's standups and Agents Office's teammates meeting at the Brain):
 * pick NPCs and a topic; they speak in turns for 1–3 rounds, Jarvis closes with decisions and
 * action items, and the minutes go to the vault (NPCs/Meetings).
 */

const date = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The round table, the speaker lit up. */
function Table({ meeting }: { meeting: NpcMeeting }): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const states = useNpcStore((s) => s.states);
  const seats = meeting.attendees
    .map((id) => npcs.find((n) => n.id === id))
    .filter((n) => n !== undefined);
  return (
    <div className="relative mx-auto my-2 size-56 shrink-0" aria-hidden>
      <div className="absolute inset-12 rounded-pill border border-line-strong bg-surface-2 shadow-[0_0_40px_-10px_var(--accent-glow)]">
        <p className="grid h-full place-items-center px-3 text-center font-code text-[10px] tracking-wider text-ink-300 uppercase">
          {meeting.status === 'running' ? 'in session' : meeting.status}
        </p>
      </div>
      {seats.map((n, i) => {
        const a = (i / seats.length) * Math.PI * 2 - Math.PI / 2;
        const speaking = meeting.status === 'running' && states[n.id] === 'working';
        return (
          <span
            key={n.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-300"
            style={{
              left: `${50 + Math.cos(a) * 42}%`,
              top: `${50 + Math.sin(a) * 42}%`,
              transform: `translate(-50%, -50%) scale(${speaking ? 1.2 : 1})`,
              filter: speaking ? `drop-shadow(0 0 10px ${NPC_HEX[n.color]})` : undefined,
            }}
          >
            <NpcBadge npc={n} size="md" />
          </span>
        );
      })}
    </div>
  );
}

export function MeetingRoom({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect(id: string | null): void;
}): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const meetings = useNpcStore((s) => s.meetings);
  const loadMeetings = useNpcStore((s) => s.loadMeetings);
  const onMeeting = useNpcStore((s) => s.onMeeting);
  const toast = useUiStore((s) => s.toast);
  const [topic, setTopic] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [rounds, setRounds] = useState(2);
  const [busy, setBusy] = useState(false);
  useEffect(() => void loadMeetings(), [loadMeetings]);
  const meeting = meetings.find((m) => m.id === selected) ?? null;
  const enabled = npcs.filter((n) => n.enabled);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      const m = await call('npcs:startMeeting', { topic: topic.trim(), attendees, rounds });
      onMeeting(m);
      onSelect(m.id);
      setTopic('');
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line-subtle p-4 max-md:w-full max-md:border-r-0 max-md:border-b">
        <section aria-labelledby="new-meeting" className="flex flex-col gap-3">
          <h2 id="new-meeting" className="hud-label">
            call a meeting
          </h2>
          <TextInput
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic: e.g. launch plan for the app"
            aria-label="Meeting topic"
          />
          <div>
            <p className="mb-1.5 text-xs text-ink-500">Who joins ({attendees.length}/6)</p>
            <div className="flex flex-wrap gap-1.5">
              {enabled.map((n) => {
                const on = attendees.includes(n.id);
                return (
                  <button
                    key={n.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setAttendees((a) =>
                        on ? a.filter((x) => x !== n.id) : a.length < 6 ? [...a, n.id] : a,
                      )
                    }
                    className={clsx(
                      'flex items-center gap-1.5 rounded-pill border py-0.5 pr-2.5 pl-0.5 text-xs transition-colors',
                      on
                        ? 'border-accent-edge bg-selected text-ink-100'
                        : 'border-line text-ink-300 hover:border-ink-500',
                    )}
                  >
                    <NpcBadge npc={n} size="sm" />
                    {n.name}
                  </button>
                );
              })}
              {enabled.length === 0 && (
                <p className="text-xs text-ink-500">Switch on an NPC first.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-500">
            Rounds
            {[1, 2, 3].map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rounds === r}
                onClick={() => setRounds(r)}
                className={clsx(
                  'size-7 rounded-sm border font-code',
                  rounds === r
                    ? 'border-accent-edge bg-selected text-ink-100'
                    : 'border-line text-ink-300',
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            disabled={busy || topic.trim().length < 3 || attendees.length === 0}
            onClick={() => void start()}
          >
            <Play size={15} aria-hidden /> Start meeting
          </Button>
        </section>
        <section aria-labelledby="past-meetings" className="flex flex-col gap-1">
          <h2 id="past-meetings" className="hud-label mb-1">
            meetings
          </h2>
          {meetings.length === 0 && <p className="text-xs text-ink-500">None yet.</p>}
          {meetings.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className={clsx(
                'rounded-sm px-2 py-1.5 text-left transition-colors',
                m.id === selected ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              <span className="flex items-center gap-2 text-sm text-ink-100">
                {m.status === 'running' && (
                  <span
                    className="size-2 rounded-pill bg-lamp-400 dot-breathe"
                    aria-label="running"
                  />
                )}
                <span className="truncate">{m.topic}</span>
              </span>
              <span className="text-xs text-ink-500">
                {date(m.createdAt)} · {m.attendees.length} NPCs · {m.status}
              </span>
            </button>
          ))}
        </section>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Meeting">
        {meeting ? (
          <>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
              <Users size={16} className="text-accent-300" aria-hidden />
              <span className="truncate font-semibold text-ink-100">{meeting.topic}</span>
              {meeting.status === 'running' && (
                <Button
                  variant="ghost"
                  className="ml-auto h-8"
                  onClick={() => void call('npcs:stopMeeting', { id: meeting.id })}
                >
                  <Square size={13} aria-hidden /> Stop
                </Button>
              )}
            </header>
            <Table meeting={meeting} />
            <ChannelLog channel={meetingChannel(meeting.id)} />
            {meeting.status === 'running' && (
              <Composer
                channel={meetingChannel(meeting.id)}
                placeholder="Add something; the next speaker will see it"
              />
            )}
          </>
        ) : (
          <div className="m-auto max-w-sm p-6 text-center">
            <Users size={28} className="mx-auto mb-3 text-accent-300" aria-hidden />
            <p className="text-sm text-ink-300">
              Call a meeting: your NPCs talk it through in turns, then Jarvis sums up the decisions
              and who does what. The minutes are saved in your vault.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
