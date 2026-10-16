import { useEffect, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import type { Npc, NpcState } from '@shared/npcs';
import { useSetting } from '../../stores/settings-store';
import { useNpcStore, type Bubble } from '../../stores/npc-store';
import { NPC_HEX, STATE_LABEL } from './npc-kit';

/**
 * The office (idea from Claw3D's 3D office and Agents Office's desks around a central brain; drawn
 * our own way with CSS 3D, no game engine): desks on an isometric floor, Jarvis on the core
 * pedestal, a glass meeting room. NPCs bob at their desks, pulse while working, walk to the
 * meeting table when called in, and say their latest line in a bubble.
 */

const W = 760;
const H = 560;
const COLS = 3;
const DESK = { x0: 70, y0: 70, dx: 140, dy: 112 };
const ROOM = { x: 500, y: 300, w: 230, h: 230 };
const TABLE = { x: ROOM.x + ROOM.w / 2, y: ROOM.y + ROOM.h / 2, r: 78 };
const CORE = { x: 615, y: 140 };

type Point = { x: number; y: number };

/** Office dressing: upright sprites on the floor. */
const DECOR: Array<Point & { emoji: string; label: string }> = [
  { x: 20, y: 20, emoji: '🪴', label: 'plant' },
  { x: 735, y: 20, emoji: '🪴', label: 'plant' },
  { x: 20, y: 540, emoji: '🪴', label: 'plant' },
  { x: 490, y: 250, emoji: '☕', label: 'coffee' },
  { x: ROOM.x + ROOM.w - 20, y: ROOM.y + 18, emoji: '📋', label: 'whiteboard' },
  { x: 700, y: 230, emoji: '🛰️', label: 'uplink' },
];

function deskAt(desk: number): Point {
  return {
    x: DESK.x0 + (desk % COLS) * DESK.dx,
    y: DESK.y0 + Math.floor(desk / COLS) * DESK.dy,
  };
}

function seatAt(i: number, of: number): Point {
  const a = (i / Math.max(of, 1)) * Math.PI * 2 - Math.PI / 4;
  return { x: TABLE.x + Math.cos(a) * TABLE.r, y: TABLE.y + Math.sin(a) * TABLE.r };
}

/** Fits the projected floor into the panel. */
function useFitScale(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const { width, height } = e.contentRect;
      // rotateZ(45°) then rotateX(58°): about 0.71·(W+H) wide and 0.37·(W+H) tall, plus figures.
      setScale(Math.max(0.35, Math.min(width / ((W + H) * 0.82), height / ((W + H) * 0.52), 1.3)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, scale];
}

function Figure({
  label,
  emoji,
  color,
  state,
  bubble,
  selected,
  onClick,
  core,
}: {
  label: string;
  emoji: React.ReactNode;
  color: string;
  state: NpcState;
  bubble: Bubble | undefined;
  selected: boolean;
  onClick?: () => void;
  core?: boolean;
}): React.JSX.Element {
  return (
    <div className="npc-figure" data-state={state} style={{ '--npc': color } as CSSProperties}>
      {bubble && (
        <p className="npc-bubble line-clamp-3" role="status">
          {bubble.text.replace(/[*_`#>]/g, '').slice(0, 160)}
        </p>
      )}
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${STATE_LABEL[state]}`}
        aria-pressed={selected}
        className={clsx(
          'npc-head cursor-pointer transition-[scale] duration-150 hover:scale-110 focus-visible:scale-110',
          selected && 'scale-110 outline-2 outline-offset-4 outline-(--npc)',
          core && 'size-14! text-3xl!',
        )}
      >
        <span className="npc-ring" />
        {emoji}
      </button>
      <span className="mt-1 rounded-xs bg-app/80 px-1.5 py-px font-code text-[10px] font-semibold tracking-wider text-ink-100 uppercase backdrop-blur-sm">
        {label}
        {state === 'working' && (
          <span className="npc-typing ml-1 text-accent-300" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        )}
        {state === 'off' && <span className="ml-1 text-ink-500">zz</span>}
      </span>
      <span className="npc-shadow" aria-hidden />
    </div>
  );
}

export function OfficeFloor({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect(id: string | null): void;
}): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const states = useNpcStore((s) => s.states);
  const bubbles = useNpcStore((s) => s.bubbles);
  const meetings = useNpcStore((s) => s.meetings);
  const name = useSetting('assistant.name') ?? 'Jarvis';
  const [ref, scale] = useFitScale();
  const running = meetings.find((m) => m.status === 'running');
  const inMeeting = new Set(running?.attendees ?? []);
  const rows = Math.max(4, Math.ceil(npcs.length / COLS));
  const floorH = Math.max(H, DESK.y0 + rows * DESK.dy + 20);

  const spotOf = (n: Npc): Point => {
    if (inMeeting.has(n.id) && running)
      return seatAt(running.attendees.indexOf(n.id), running.attendees.length + 1);
    const d = deskAt(n.desk);
    return { x: d.x + 37, y: d.y + 64 };
  };
  // Jarvis takes the head of the table while a meeting runs.
  const jarvisSpot = running
    ? seatAt(running.attendees.length, running.attendees.length + 1)
    : CORE;

  return (
    <div
      ref={ref}
      className="npc-office relative min-h-0 flex-1 overflow-hidden"
      onClick={(e) => e.target === e.currentTarget && onSelect(null)}
      role="region"
      aria-label="Office"
    >
      <div
        className="npc-floor"
        style={{ width: W, height: floorH, '--office-scale': scale } as CSSProperties}
      >
        <div className="npc-zone" style={{ left: 30, top: 30, width: 450, height: floorH - 60 }}>
          <span className="hud-label absolute -top-5 left-2 text-3xs!">work floor</span>
        </div>
        {Array.from({ length: rows * COLS }, (_, i) => {
          const d = deskAt(i);
          const owner = npcs.find((n) => n.desk === i);
          return (
            <div
              key={i}
              className="npc-desk"
              data-off={owner ? !owner.enabled : true}
              style={
                {
                  left: d.x,
                  top: d.y,
                  '--desk-glow': owner ? NPC_HEX[owner.color] : undefined,
                } as CSSProperties
              }
            />
          );
        })}
        <div
          className="npc-meeting-room"
          style={{ left: ROOM.x, top: ROOM.y, width: ROOM.w, height: ROOM.h }}
        >
          <span className="hud-label absolute -top-5 left-2 text-3xs!">
            meeting room{running ? ' · in session' : ''}
          </span>
        </div>
        <div
          className="npc-table"
          style={{ left: TABLE.x - 52, top: TABLE.y - 52, width: 104, height: 104 }}
        />
        <div
          className="npc-table"
          style={{
            left: CORE.x - 44,
            top: CORE.y - 30,
            width: 88,
            height: 88,
            boxShadow: '0 0 40px -6px var(--accent-glow)',
          }}
        />

        {DECOR.map((d) => (
          <div
            key={`${d.x}-${d.y}`}
            className="npc-spot"
            style={{ transform: `translate(${d.x}px, ${d.y}px)` }}
            aria-hidden
          >
            <span className="npc-figure pointer-events-none! text-2xl drop-shadow-sm">
              {d.emoji}
            </span>
          </div>
        ))}
        <div
          className="npc-spot"
          style={{ transform: `translate(${jarvisSpot.x}px, ${jarvisSpot.y}px)` }}
        >
          <Figure
            label={name}
            emoji={<span className="text-accent-300">◉</span>}
            color="var(--accent-500)"
            state={running ? 'meeting' : 'idle'}
            bubble={bubbles['jarvis']}
            selected={false}
            core
          />
        </div>
        {npcs.map((n) => {
          const p = spotOf(n);
          return (
            <div
              key={n.id}
              className="npc-spot"
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            >
              <Figure
                label={n.name}
                emoji={n.emoji}
                color={NPC_HEX[n.color]}
                state={n.enabled ? (states[n.id] ?? 'idle') : 'off'}
                bubble={bubbles[n.id]}
                selected={selected === n.id}
                onClick={() => onSelect(selected === n.id ? null : n.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
