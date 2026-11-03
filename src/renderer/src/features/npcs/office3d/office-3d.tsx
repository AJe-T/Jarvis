import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import clsx from 'clsx';
import { Crosshair, LayoutGrid, Moon, Sun } from 'lucide-react';
import type { Npc, NpcState } from '@shared/npcs';
import { useReducedMotion } from '../../../lib/use-reduced-motion';
import { useSetting } from '../../../stores/settings-store';
import { HANDOFF_MS, useNpcStore } from '../../../stores/npc-store';
import { NPC_HEX, STATE_LABEL } from '../npc-kit';
import { Avatar, type AvatarTarget } from './avatar';
import { Burst, BURST_MS, HandoffArc, type BurstInfo } from './effects';
import { Core, Desks, Floor, Lounge, MeetingRoom, Monitor, Plants, Walls } from './furniture';
import { daylight, deskSpot, planFor, routeToSeat, seatAt, type P, type Plan } from './layout';
import { themeColor } from './materials';

/**
 * The 3D office (2.51): Sir's NPC team in a real 3D open-plan office, built with three.js. Ideas from
 * six open-source agent offices (credited in BIBLE §12): Claw3D and Hermes Virtual Office (agents at
 * desks you can orbit around, avatars walking to meet), Agentshire (day and night, finish fireworks,
 * click for a status card), Pixel Agents (a pose per activity), The Delegation (a status overlay per
 * agent) and AI Town (a living place, not a list). Our own code and our own procedural art.
 *
 * The canvas is decoration; everything that matters is also HTML over it: each NPC's name tag is a
 * real button (screen readers and keyboard work), its line is a speech bubble, and the HUD says who
 * is doing what. "Classic" switches back to the flat office.
 */

const BUBBLE_FRESH_MS = 6000;
/** Past this distance a name tag shrinks to its emoji badge (the name shows on hover and focus). */
const FAR_TAG_M = 15;

function useDaylight(): number {
  const [day, setDay] = useState(() => {
    const d = new Date();
    return daylight(d.getHours() + d.getMinutes() / 60);
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setDay(daylight(d.getHours() + d.getMinutes() / 60));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return day;
}

/** Where everyone should be: their desk, or their meeting seat (and the route between). */
function useTargets(
  npcs: Npc[],
  attendees: string[] | null,
  meetingId: string | null,
  plan: Plan,
): Map<string, AvatarTarget> {
  const lastSeat = useRef(new Map<string, P>());
  return useMemo(() => {
    const out = new Map<string, AvatarTarget>();
    const of = (attendees?.length ?? 0) + 1;
    for (const n of npcs) {
      const desk = deskSpot(n.desk, plan);
      const i = attendees?.indexOf(n.id) ?? -1;
      if (i >= 0 && meetingId) {
        const seat = seatAt(i, of, plan);
        lastSeat.current.set(n.id, seat);
        out.set(n.id, {
          spot: seat,
          facing: seat.facing,
          route: routeToSeat(n.desk, seat, plan),
          key: `meet:${meetingId}:${i}`,
        });
      } else {
        const from = lastSeat.current.get(n.id);
        out.set(n.id, {
          spot: desk.chair,
          facing: desk.facing,
          route: from ? routeToSeat(n.desk, from, plan).reverse() : [desk.chair],
          key: `desk:${n.desk}:${plan.podsPerRow}`,
        });
      }
    }
    return out;
  }, [npcs, attendees, meetingId, plan]);
}

/** Orbit, zoom and pan, and a short flight to whoever Sir selects. */
function CameraRig({
  plan,
  focusId,
  heads,
  resetKey,
  reduced,
}: {
  plan: Plan;
  /** Who to fly to; the flight starts once their head position is known. */
  focusId: string | null;
  heads: Map<string, THREE.Vector3>;
  resetKey: number;
  reduced: boolean;
}): null {
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const flight = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);
  const pending = useRef<string | null>(null);
  const span = Math.max(
    plan.bounds.max.x - plan.bounds.min.x,
    plan.bounds.max.z - plan.bounds.min.z,
  );
  const home = useMemo(() => {
    const c = plan.bounds.centre;
    return {
      target: new THREE.Vector3(c.x, 0.6, c.z),
      pos: new THREE.Vector3(c.x - span * 0.22, span * 0.55, c.z + span * 0.72),
    };
  }, [plan, span]);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = 1.32;
    c.minDistance = 3;
    c.screenSpacePanning = false;
    c.addEventListener('start', () => {
      flight.current = null;
    });
    controls.current = c;
    return () => c.dispose();
  }, [camera, gl]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.maxDistance = span * 2.4;
    c.target.copy(home.target);
    camera.position.copy(home.pos);
    flight.current = null;
    c.update();
  }, [home, span, camera, resetKey]);

  // A new selection: fly there once (then Sir is free to look around).
  useEffect(() => {
    pending.current = focusId;
  }, [focusId]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const at = pending.current ? heads.get(pending.current) : undefined;
    if (at) {
      pending.current = null;
      const offset = camera.position.clone().sub(c.target).setLength(7);
      offset.y = Math.max(offset.y, 3.5);
      const target = at.clone().setY(0.8);
      const pos = target.clone().add(offset);
      if (reduced) {
        c.target.copy(target);
        camera.position.copy(pos);
      } else flight.current = { target, pos };
    }
    const f = flight.current;
    if (f) {
      const k = Math.min(1, dt * 4);
      c.target.lerp(f.target, k);
      camera.position.lerp(f.pos, k);
      if (camera.position.distanceTo(f.pos) < 0.05) flight.current = null;
    }
    c.update();
  });
  return null;
}

/** Name tags and speech bubbles follow heads on screen; written straight to the DOM each frame. */
function OverlaySync({
  heads,
  tags,
}: {
  heads: Map<string, THREE.Vector3>;
  tags: React.RefObject<Map<string, HTMLDivElement>>;
}): null {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [id, el] of tags.current) {
      const at = heads.get(id);
      if (!at) {
        el.style.visibility = 'hidden';
        continue;
      }
      const far = camera.position.distanceTo(at) > FAR_TAG_M ? '1' : '0';
      if (el.dataset['far'] !== far) el.dataset['far'] = far;
      v.copy(at)
        .setY(at.y + 0.35)
        .project(camera);
      const hidden = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
      el.style.visibility = hidden ? 'hidden' : 'visible';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 10_000));
    }
  });
  return null;
}

/** Jarvis in a meeting: a small hologram of the core over the head of the table. */
function JarvisPresence({
  plan,
  seat,
  heads,
  accent,
}: {
  plan: Plan;
  seat: P | null;
  heads: Map<string, THREE.Vector3>;
  accent: string;
}): React.JSX.Element | null {
  const orb = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const p = seat ?? plan.core;
    const y = seat ? 1.35 + Math.sin(clock.elapsedTime * 2) * 0.05 : 1.35;
    if (orb.current) orb.current.position.set(p.x, y, p.z);
    const v = heads.get('jarvis') ?? new THREE.Vector3();
    heads.set('jarvis', v.set(p.x, y + 0.25, p.z));
  });
  useEffect(() => () => void heads.delete('jarvis'), [heads]);
  return seat ? (
    <mesh ref={orb}>
      <icosahedronGeometry args={[0.22, 1]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.8} wireframe />
    </mesh>
  ) : null;
}

function Scene({
  plan,
  npcs,
  states,
  speaking,
  selected,
  onSelect,
  heads,
  accent,
  day,
  reduced,
  resetKey,
  tags,
}: {
  plan: Plan;
  npcs: Npc[];
  states: Record<string, NpcState>;
  speaking: Set<string>;
  selected: string | null;
  onSelect(id: string | null): void;
  heads: Map<string, THREE.Vector3>;
  accent: string;
  day: number;
  reduced: boolean;
  resetKey: number;
  tags: React.RefObject<Map<string, HTMLDivElement>>;
}): React.JSX.Element {
  const meetings = useNpcStore((s) => s.meetings);
  const handoffs = useNpcStore((s) => s.handoffs);
  const running = meetings.find((m) => m.status === 'running') ?? null;
  const attendees = running?.attendees ?? null;
  const targets = useTargets(npcs, attendees, running?.id ?? null, plan);
  const stateOf = (n: Npc): NpcState => (n.enabled ? (states[n.id] ?? 'idle') : 'off');
  const deskCount = Math.max(...npcs.map((n) => n.desk + 1), npcs.length, 8);
  const byDesk = new Map(npcs.map((n) => [n.desk, n]));

  // Bursts: an NPC that stops working just finished a job.
  const [bursts, setBursts] = useState<BurstInfo[]>([]);
  const prev = useRef<Record<string, NpcState>>({});
  const bubbles = useNpcStore((s) => s.bubbles);
  useEffect(() => {
    const now = Date.now();
    const done: BurstInfo[] = [];
    for (const n of npcs) {
      const was = prev.current[n.id];
      const is = stateOf(n);
      if (was === 'working' && is !== 'working' && is !== 'off')
        done.push({
          id: `${n.id}:${now}`,
          npc: n.id,
          at: now,
          error: Boolean(bubbles[n.id]?.text.startsWith('⚠️')),
        });
      prev.current[n.id] = is;
    }
    if (done.length) setBursts((b) => [...b.filter((x) => now - x.at < BURST_MS), ...done]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, npcs]);

  // Sir's tags start from where he stands: the office entrance, in front of the camera.
  useEffect(() => {
    heads.set('sir', new THREE.Vector3(plan.bounds.centre.x, 2.4, plan.bounds.max.z));
  }, [heads, plan]);

  const day3 = useMemo(() => new THREE.Color('#fff4e0'), []);
  const night3 = useMemo(() => new THREE.Color('#7aa2ff'), []);
  const sun = useMemo(() => night3.clone().lerp(day3, day), [day, day3, night3]);
  const centre = plan.bounds.centre;
  const colorOf = (id: string): string =>
    id === 'jarvis' || id === 'sir'
      ? accent
      : NPC_HEX[npcs.find((n) => n.id === id)?.color ?? 'cyan'];

  return (
    <>
      <ambientLight intensity={0.35 + day * 0.35} />
      <hemisphereLight args={['#bcd7ff', '#0b1220', 0.35 + day * 0.4]} />
      <directionalLight
        color={sun}
        intensity={0.5 + day * 1.3}
        position={[centre.x - 8, 14, centre.z + 6]}
      />
      <Floor plan={plan} accent={accent} />
      <Walls plan={plan} day={day} />
      <Desks plan={plan} count={deskCount} />
      {Array.from({ length: deskCount }, (_, d) => {
        const owner = byDesk.get(d);
        return (
          <Monitor
            key={d}
            plan={plan}
            desk={d}
            color={owner ? NPC_HEX[owner.color] : null}
            state={owner ? stateOf(owner) : null}
          />
        );
      })}
      <MeetingRoom plan={plan} active={Boolean(running)} accent={accent} />
      <Core plan={plan} accent={accent} busy={speaking.has('jarvis') && !running} />
      <Plants plan={plan} />
      <Lounge plan={plan} accent={accent} />
      <JarvisPresence
        plan={plan}
        seat={attendees ? seatAt(attendees.length, attendees.length + 1, plan) : null}
        heads={heads}
        accent={accent}
      />
      {npcs.map((n) => {
        const t = targets.get(n.id);
        return t ? (
          <Avatar
            key={n.id}
            id={n.id}
            color={NPC_HEX[n.color]}
            state={stateOf(n)}
            speaking={speaking.has(n.id)}
            selected={selected === n.id}
            target={t}
            heads={heads}
            reduced={reduced}
            onSelect={() => onSelect(selected === n.id ? null : n.id)}
          />
        ) : null;
      })}
      {!reduced &&
        handoffs
          .filter((h) => Date.now() - h.at < HANDOFF_MS)
          .map((h) => <HandoffArc key={h.id} h={h} heads={heads} color={colorOf(h.from)} />)}
      {!reduced &&
        bursts.map((b) => <Burst key={b.id} b={b} heads={heads} color={colorOf(b.npc)} />)}
      <CameraRig
        plan={plan}
        focusId={selected}
        heads={heads}
        resetKey={resetKey}
        reduced={reduced}
      />
      <OverlaySync heads={heads} tags={tags} />
    </>
  );
}

function Tag({
  label,
  emoji,
  color,
  state,
  bubble,
  selected,
  onClick,
  tagRef,
}: {
  label: string;
  emoji: React.ReactNode;
  color: string;
  state: NpcState;
  bubble: string | null;
  selected: boolean;
  onClick?: () => void;
  tagRef(el: HTMLDivElement | null): void;
}): React.JSX.Element {
  return (
    <div
      ref={tagRef}
      className="office3d-tag"
      data-state={state}
      style={{ '--npc': color, visibility: 'hidden' } as CSSProperties}
    >
      {bubble && (
        <p className="office3d-bubble line-clamp-3" role="status">
          {bubble}
        </p>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        aria-label={`${label}: ${STATE_LABEL[state]}`}
        aria-pressed={onClick ? selected : undefined}
        className={clsx('office3d-name', selected && 'is-selected')}
      >
        <span aria-hidden>{emoji}</span>
        <span className="office3d-label">{label}</span>
        {state === 'working' && (
          <span className="npc-typing text-accent-300" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        )}
        {state === 'off' && <span className="text-ink-500">zz</span>}
      </button>
    </div>
  );
}

export function Office3D({
  selected,
  onSelect,
  onClassic,
}: {
  selected: string | null;
  onSelect(id: string | null): void;
  onClassic(): void;
}): React.JSX.Element {
  const npcs = useNpcStore((s) => s.npcs);
  const states = useNpcStore((s) => s.states);
  const bubbles = useNpcStore((s) => s.bubbles);
  const handoffs = useNpcStore((s) => s.handoffs);
  const meetings = useNpcStore((s) => s.meetings);
  const name = useSetting('assistant.name') || 'Jarvis';
  const reduced = useReducedMotion();
  const day = useDaylight();
  const [resetKey, setResetKey] = useState(0);
  const [accent] = useState(() => themeColor('--accent-500', '#22d3ee'));
  const heads = useMemo(() => new Map<string, THREE.Vector3>(), []);
  const tags = useRef(new Map<string, HTMLDivElement>());
  const highest = Math.max(-1, ...npcs.map((n) => n.desk));
  const plan = useMemo(() => planFor(npcs.length, highest), [npcs.length, highest]);
  const running = meetings.find((m) => m.status === 'running');

  // Re-render while hand-offs or speech are fresh so they expire on time.
  const [, tick] = useState(0);
  const live =
    handoffs.some((h) => Date.now() - h.at < HANDOFF_MS) || Object.keys(bubbles).length > 0;
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live]);

  const now = Date.now();
  const speaking = new Set(
    Object.entries(bubbles)
      .filter(([, b]) => now - b.at < BUBBLE_FRESH_MS)
      .map(([id]) => id),
  );
  const stateOf = (n: Npc): NpcState => (n.enabled ? (states[n.id] ?? 'idle') : 'off');
  const count = (s: NpcState): number => npcs.filter((n) => stateOf(n) === s).length;
  const line = (id: string): string | null => {
    const b = bubbles[id];
    return b && now - b.at < BUBBLE_FRESH_MS ? b.text.replace(/[*_`#>]/g, '').slice(0, 160) : null;
  };
  const tagRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) tags.current.set(id, el);
    else tags.current.delete(id);
  };

  return (
    <div
      className="office3d relative min-h-0 flex-1 overflow-hidden"
      role="region"
      aria-label="Office"
    >
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.1, far: 400 }}
        onPointerMissed={() => onSelect(null)}
        aria-hidden
      >
        <Scene
          plan={plan}
          npcs={npcs}
          states={states}
          speaking={speaking}
          selected={selected}
          onSelect={onSelect}
          heads={heads}
          accent={accent}
          day={day}
          reduced={reduced}
          resetKey={resetKey}
          tags={tags}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-0">
        <Tag
          label={name}
          emoji={<span className="text-accent-300">◉</span>}
          color="var(--accent-500)"
          state={running ? 'meeting' : 'idle'}
          bubble={line('jarvis')}
          selected={false}
          tagRef={tagRef('jarvis')}
        />
        {npcs.map((n) => (
          <Tag
            key={n.id}
            label={n.name}
            emoji={n.emoji}
            color={NPC_HEX[n.color]}
            state={stateOf(n)}
            bubble={line(n.id)}
            selected={selected === n.id}
            onClick={() => onSelect(selected === n.id ? null : n.id)}
            tagRef={tagRef(n.id)}
          />
        ))}
      </div>

      <div className="office3d-hud pointer-events-none absolute top-3 left-3 flex flex-col gap-2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-sm border border-line-subtle bg-app/75 px-3 py-1.5 font-code text-xs text-ink-300 backdrop-blur-sm">
          <span
            className="flex items-center gap-1"
            title={day > 0.5 ? 'Daytime (follows your clock)' : 'Night (follows your clock)'}
          >
            {day > 0.5 ? <Sun size={13} aria-hidden /> : <Moon size={13} aria-hidden />}
          </span>
          <span>
            <b className="text-accent-300">{count('working')}</b> working
          </span>
          <span>
            <b className="text-ok-400">{count('idle')}</b> at desk
          </span>
          <span>
            <b className="text-lamp-400">{count('meeting')}</b> in meeting
          </span>
          <span>
            <b className="text-ink-500">{count('off')}</b> off
          </span>
        </div>
      </div>
      <div className="absolute top-3 right-3 flex gap-1.5">
        <button
          type="button"
          className="office3d-btn"
          onClick={() => setResetKey((k) => k + 1)}
          title="Back to the whole office"
        >
          <Crosshair size={14} aria-hidden /> Reset view
        </button>
        <button
          type="button"
          className="office3d-btn"
          onClick={onClassic}
          title="The flat office (lighter on old PCs)"
        >
          <LayoutGrid size={14} aria-hidden /> Classic
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 font-code text-[10px] text-ink-500">
        drag to orbit · right-drag to pan · scroll to zoom · click someone for their file
      </p>
    </div>
  );
}
