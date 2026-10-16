import { useEffect, useState } from 'react';
import { Building2, MessagesSquare, Plus, Users, Contact } from 'lucide-react';
import clsx from 'clsx';
import { OFFICE, type Npc } from '@shared/npcs';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page';
import { useNpcStore } from '../../stores/npc-store';
import { NpcEditor } from './npc-editor';
import { MeetingRoom } from './meeting-room';
import { OfficeFloor } from './office-floor';
import { Dossier, Roster } from './roster';
import { ChannelLog, Composer, TeamChat } from './team-chat';
import './npcs.css';

/**
 * NPCs (2.21): Sir's team of single-purpose agents, Jarvis at their head. Office (the floor, live),
 * Team chat (#office with @tags, private chats), Meeting room, Roster (hire from templates, on/off).
 */

type Tab = 'office' | 'chat' | 'meeting' | 'roster';
const TABS: Array<{ id: Tab; label: string; Icon: typeof Users }> = [
  { id: 'office', label: 'Office', Icon: Building2 },
  { id: 'chat', label: 'Team chat', Icon: MessagesSquare },
  { id: 'meeting', label: 'Meeting room', Icon: Users },
  { id: 'roster', label: 'Roster', Icon: Contact },
];
const TAB_KEY = 'jarvis.npcs.tab';

function savedTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'office';
  } catch {
    return 'office';
  }
}

export function NpcsView(): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const loaded = useNpcStore((s) => s.loaded);
  const load = useNpcStore((s) => s.load);
  const loadMeetings = useNpcStore((s) => s.loadMeetings);
  const [tab, setTab] = useState<Tab>(savedTab);
  const [channel, setChannel] = useState(OFFICE);
  const [selected, setSelected] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<string | null>(null);
  const [editing, setEditing] = useState<Npc | 'new' | null>(null);
  useEffect(() => {
    void load();
    void loadMeetings();
  }, [load, loadMeetings]);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // not remembered
    }
  }, [tab]);
  // A meeting starting (from Jarvis or here) opens in the meeting room view when Sir is there.
  const running = useNpcStore((s) => s.meetings.find((m) => m.status === 'running'));
  const current = npcs.find((n) => n.id === selected);
  const openChat = (c: string): void => {
    setChannel(c);
    setTab('chat');
  };

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <PageHeader title="NPCs" help="npcs">
        <div
          role="tablist"
          aria-label="NPC views"
          className="flex items-center gap-0.5 rounded-sm border border-line-subtle p-0.5"
        >
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={clsx(
                'relative flex h-7 items-center gap-1.5 rounded-xs px-2.5 font-code text-xs tracking-wide transition-colors',
                tab === id
                  ? 'bg-selected text-ink-100'
                  : 'text-ink-300 hover:bg-hover hover:text-ink-100',
              )}
            >
              <Icon size={14} aria-hidden />
              <span className="max-md:hidden">{label}</span>
              {id === 'meeting' && running && (
                <span
                  className="size-1.5 rounded-pill bg-lamp-400 dot-breathe"
                  aria-label="meeting running"
                />
              )}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          className="h-8"
          aria-label="Hire NPC"
          onClick={() => setEditing('new')}
        >
          <Plus size={14} aria-hidden /> <span className="max-md:hidden">Hire</span>
        </Button>
      </PageHeader>

      {tab === 'office' && (
        <div className="flex min-h-0 flex-1">
          <OfficeFloor selected={selected} onSelect={setSelected} />
          <aside className="flex w-96 shrink-0 flex-col border-l border-line-subtle bg-app max-lg:hidden">
            {current ? (
              <Dossier
                npc={current}
                onEdit={() => setEditing(current)}
                onChat={openChat}
                onClose={() => setSelected(null)}
              />
            ) : (
              <>
                <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
                  <span className="size-2 rounded-pill bg-ok-400 dot-breathe" aria-hidden />
                  <span className="hud-label">live · #office</span>
                </header>
                <ChannelLog channel={OFFICE} />
                <Composer channel={OFFICE} placeholder="Tell the team… (@Name to tag)" />
              </>
            )}
          </aside>
        </div>
      )}
      {tab === 'chat' && <TeamChat channel={channel} onChannel={setChannel} />}
      {tab === 'meeting' && (
        <MeetingRoom selected={meeting ?? running?.id ?? null} onSelect={setMeeting} />
      )}
      {tab === 'roster' && (
        <Roster onHire={() => setEditing('new')} onEdit={(n) => setEditing(n)} onChat={openChat} />
      )}
      {loaded && npcs.length === 0 && tab === 'office' && editing === null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
          <Button
            variant="primary"
            className="pointer-events-auto"
            onClick={() => setEditing('new')}
          >
            <Plus size={15} aria-hidden /> Hire your first NPC
          </Button>
        </div>
      )}
      {editing && (
        <NpcEditor npc={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
