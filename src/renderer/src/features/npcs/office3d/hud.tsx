import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type * as THREE from 'three';
import type { Npc, NpcState } from '@shared/npcs';
import { NPC_HEX, STATE_LABEL } from '../npc-kit';
import { STATE_GEM } from './avatar';
import { deskSpot, podCentre, type Plan } from './layout';

/**
 * The game HUD over the 3D office (2.52): a party bar of hex portraits (click to fly to someone), a
 * radar minimap, "achievement" toasts when someone finishes a job, and the squad status panel. Plain
 * HTML and canvas over the WebGL view, so it stays sharp and accessible.
 */

export interface Toast {
  id: string;
  title: string;
  text: string;
  color: string;
  error: boolean;
}

export function SquadPanel({
  counts,
  day,
}: {
  counts: Record<NpcState, number>;
  day: number;
}): React.JSX.Element {
  const rows: Array<[NpcState, string]> = [
    ['working', 'Working'],
    ['idle', 'At desk'],
    ['meeting', 'Meeting'],
    ['off', 'Off'],
  ];
  return (
    <section aria-label="Squad status" className="holo-frame holo-squad">
      <header className="holo-title">
        <span className="holo-dot" aria-hidden /> squad · {day > 0.5 ? 'day shift' : 'night shift'}
      </header>
      <ul>
        {rows.map(([s, label]) => (
          <li key={s}>
            <span
              className="holo-gem"
              style={{ background: STATE_GEM[s], color: STATE_GEM[s] }}
              aria-hidden
            />
            <span className="holo-count">{counts[s]}</span>
            <span className="holo-label">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Hex portraits along the bottom: who's here and what they're doing; click to fly to them. */
export function PartyBar({
  npcs,
  stateOf,
  selected,
  onSelect,
}: {
  npcs: Npc[];
  stateOf(n: Npc): NpcState;
  selected: string | null;
  onSelect(id: string | null): void;
}): React.JSX.Element | null {
  if (npcs.length === 0) return null;
  return (
    <nav aria-label="Team" className="holo-party">
      {npcs.map((n) => {
        const s = stateOf(n);
        return (
          <button
            key={n.id}
            type="button"
            className={clsx('holo-member', selected === n.id && 'is-selected')}
            data-state={s}
            style={{ '--npc': NPC_HEX[n.color], '--gem': STATE_GEM[s] } as React.CSSProperties}
            onClick={() => onSelect(selected === n.id ? null : n.id)}
            aria-label={`Go to ${n.name}, ${n.role}: ${STATE_LABEL[s]}`}
            aria-pressed={selected === n.id}
          >
            <span className="holo-hex" aria-hidden>
              <span className="holo-hex-inner">{n.emoji}</span>
            </span>
            <span className="holo-member-name">{n.name}</span>
            <span className="holo-meter" aria-hidden>
              <span />
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * A round radar in the corner: the deck, islands, the war-room, the core, and everyone as a dot in
 * their colour, read from the live head positions ten times a second.
 */
export function Minimap({
  plan,
  npcs,
  heads,
  selected,
  accent,
}: {
  plan: Plan;
  npcs: Npc[];
  heads: Map<string, THREE.Vector3>;
  selected: string | null;
  accent: string;
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const SIZE = 148;
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    g.scale(dpr, dpr);
    const { min, max, centre } = plan.bounds;
    const span = Math.max(max.x - min.x, max.z - min.z) * 1.08;
    const k = (SIZE - 16) / span;
    const map = (x: number, z: number): [number, number] => [
      SIZE / 2 + (x - centre.x) * k,
      SIZE / 2 + (z - centre.z) * k,
    ];
    const draw = (): void => {
      g.clearRect(0, 0, SIZE, SIZE);
      g.save();
      g.beginPath();
      g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = 'rgba(4,8,16,0.82)';
      g.fillRect(0, 0, SIZE, SIZE);
      g.strokeStyle = accent;
      g.globalAlpha = 0.25;
      for (let r = 20; r < SIZE / 2; r += 20) {
        g.beginPath();
        g.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 0.55;
      const [x0, z0] = map(min.x, min.z);
      const [x1, z1] = map(max.x, max.z);
      g.strokeRect(x0, z0, x1 - x0, z1 - z0);
      const pods = Math.ceil(Math.max(npcs.length, 1) / 4);
      for (let p = 0; p < pods; p++) {
        const c0 = podCentre(p, plan);
        const [px, pz] = map(c0.x, c0.z);
        g.beginPath();
        g.arc(px, pz, 0.98 * k, 0, Math.PI * 2);
        g.stroke();
      }
      const [tx, tz] = map(plan.room.table.x, plan.room.table.z);
      g.beginPath();
      g.arc(tx, tz, (plan.room.size / 2) * k, 0, Math.PI * 2);
      g.stroke();
      const [cx, cz] = map(plan.core.x, plan.core.z);
      g.globalAlpha = 1;
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(cx, cz - 5);
      g.lineTo(cx + 4, cz);
      g.lineTo(cx, cz + 5);
      g.lineTo(cx - 4, cz);
      g.fill();
      for (const n of npcs) {
        const at = heads.get(n.id);
        const p = at ? { x: at.x, z: at.z } : deskSpot(n.desk, plan).chair;
        const [nx, nz] = map(p.x, p.z);
        g.fillStyle = n.enabled ? NPC_HEX[n.color] : '#64748b';
        g.beginPath();
        g.arc(nx, nz, selected === n.id ? 4.2 : 2.8, 0, Math.PI * 2);
        g.fill();
        if (selected === n.id) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.2;
          g.stroke();
        }
      }
      g.restore();
    };
    draw();
    const t = setInterval(draw, 100);
    return () => clearInterval(t);
  }, [plan, npcs, heads, selected, accent]);
  return (
    <div className="holo-radar" aria-hidden>
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
      <span className="holo-sweep" />
    </div>
  );
}

/** "Achievement" toasts: someone finished a job (or hit a wall). */
export function Toasts({ toasts }: { toasts: Toast[] }): React.JSX.Element {
  return (
    <div className="holo-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx('holo-toast', t.error && 'is-error')}
          style={{ '--npc': t.color } as React.CSSProperties}
        >
          <span className="holo-toast-icon" aria-hidden>
            {t.error ? '!' : '✦'}
          </span>
          <span>
            <b>{t.title}</b>
            <span>{t.text}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
