import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import clsx from 'clsx';
import { Crosshair, Gauge, LayoutGrid, Sparkles } from 'lucide-react';
import type { Npc, NpcState } from '@shared/npcs';
import { useReducedMotion } from '../../../lib/use-reduced-motion';
import { useSetting } from '../../../stores/settings-store';
import { HANDOFF_MS, useNpcStore } from '../../../stores/npc-store';
import { NPC_HEX, STATE_LABEL } from '../npc-kit';
import { Avatar, STATE_GEM, type AvatarTarget } from './avatar';
import { Burst, BURST_MS, HandoffArc, type BurstInfo } from './effects';
import {
  JarvisTerminal,
  Lounge,
  MeetingRoom,
  Plants,
  PodLights,
  Room,
  Workstations,
} from './furniture';
import { Minimap, PartyBar, SquadPanel, Toasts, type Toast } from './hud';
import { daylight, deskSpot, planFor, routeToSeat, seatAt, type P, type Plan } from './layout';
import { themeColor } from './materials';
import { Bloom, Environment } from './post';

/**
 * The 3D office (2.51; the cosy isometric office 2.54): Sir's NPC team in a cut-away office at night. Ideas from
 * six open-source agent offices (credited in BIBLE §12): Claw3D and Hermes Virtual Office (agents at
 * desks you can orbit around, going to meet), Agentshire (day and night, finish fireworks, a status
 * card), Pixel Agents (a pose per activity), The Delegation (a status overlay per agent) and AI Town
 * (a living place, not a list). Our own code and our own procedural art.
 *
 * The canvas is decoration; everything that matters is also HTML over it: each NPC's name plate is a
 * real button, its line is a speech bubble, and the HUD (squad panel, party bar, radar, toasts) says
 * who is doing what. "Classic" switches back to the flat office; "Performance" drops glow and shadows.
 */

const BUBBLE_FRESH_MS = 6000;
/** Below this many pixels per metre a name plate shrinks to its badge (the name shows on hover and focus). */
const FAR_TAG_PPM = 26;
const SKY = '#14161c';
/** Below this many frames a second (after the intro), the office switches itself to Performance. */
const SLOW_FPS = 38;
const TOAST_MS = 3800;
const QUALITY_KEY = 'jarvis.npcs.quality';

type Quality = 'high' | 'low';

/** Sir's own pick, or null while the quality is automatic. */
function savedQuality(): Quality | null {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return q === 'low' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

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

/** Where everyone should be: their seat at the island, or their war-room seat (and the route between). */
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

/**
 * The isometric camera (2.54): an orthographic view from the front-right at about 35°, like a
 * strategy game. Zoom and pan freely; turning is limited to a quarter so the cut-away walls stay at
 * the back. A zoom-in when the office opens, and a short glide to whoever Sir selects.
 */
function CameraRig({
  plan,
  focusId,
  heads,
  resetKey,
  reduced,
}: {
  plan: Plan;
  focusId: string | null;
  heads: Map<string, THREE.Vector3>;
  resetKey: number;
  reduced: boolean;
}): null {
  const { camera, gl, size } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const flight = useRef<{ target: THREE.Vector3; zoom: number; speed: number } | null>(null);
  const pending = useRef<string | null>(null);
  const opened = useRef(false);
  const span = Math.max(
    plan.bounds.max.x - plan.bounds.min.x,
    plan.bounds.max.z - plan.bounds.min.z,
  );
  // The zoom that fits the whole office on screen.
  const fit = Math.min(size.width / (span * 1.5), size.height / (span * 0.95));
  const centre = useMemo(
    () => new THREE.Vector3(plan.bounds.centre.x, 0.6, plan.bounds.centre.z),
    [plan],
  );

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.1;
    c.screenSpacePanning = true;
    c.minPolarAngle = 0.75;
    c.maxPolarAngle = 1.05;
    c.minAzimuthAngle = Math.PI / 4 - 0.6;
    c.maxAzimuthAngle = Math.PI / 4 + 0.6;
    c.zoomToCursor = true;
    c.addEventListener('start', () => {
      flight.current = null;
    });
    controls.current = c;
    return () => c.dispose();
  }, [camera, gl]);

  useEffect(() => {
    const c = controls.current;
    const cam = camera as THREE.OrthographicCamera;
    if (!c) return;
    c.minZoom = fit * 0.7;
    c.maxZoom = fit * 5;
    c.target.copy(centre);
    // Front-right, about 35° above the floor.
    cam.position.copy(centre).add(new THREE.Vector3(1, 0.98, 1).normalize().multiplyScalar(60));
    if (!opened.current && !reduced) {
      cam.zoom = fit * 0.7;
      flight.current = { target: centre.clone(), zoom: fit * 1.25, speed: 2.2 };
    } else {
      cam.zoom = fit * 1.25;
      flight.current = null;
    }
    cam.updateProjectionMatrix();
    opened.current = true;
    c.update();
  }, [centre, fit, camera, resetKey, reduced]);

  useEffect(() => {
    pending.current = focusId;
  }, [focusId]);

  useFrame((_, dt) => {
    const c = controls.current;
    const cam = camera as THREE.OrthographicCamera;
    if (!c) return;
    const at = pending.current ? heads.get(pending.current) : undefined;
    if (at) {
      pending.current = null;
      const target = at.clone().setY(0.8);
      const zoom = Math.max(cam.zoom, fit * 2.4);
      if (reduced) {
        const shift = target.clone().sub(c.target);
        c.target.add(shift);
        cam.position.add(shift);
        cam.zoom = zoom;
        cam.updateProjectionMatrix();
      } else flight.current = { target, zoom, speed: 4 };
    }
    const f = flight.current;
    if (f) {
      const k = Math.min(1, dt * f.speed);
      const shift = f.target.clone().sub(c.target).multiplyScalar(k);
      c.target.add(shift);
      cam.position.add(shift);
      cam.zoom += (f.zoom - cam.zoom) * k;
      cam.updateProjectionMatrix();
      if (shift.length() < 0.002 && Math.abs(f.zoom - cam.zoom) < 0.05) flight.current = null;
    }
    c.update();
  });
  return null;
}

/**
 * Measures the frame rate for a few seconds after the intro; tells the office when this PC is slow,
 * so it can switch to Performance by itself (Sir's laptop has no graphics card).
 */
function FpsProbe({ onSlow }: { onSlow(fps: number): void }): null {
  const t = useRef({ frames: 0, time: 0, done: false });
  useFrame((_, dt) => {
    const p = t.current;
    if (p.done) return;
    p.time += dt;
    // Skip the first 2.5 s (intro, shader compile), then count 3 s.
    if (p.time < 2.5) return;
    p.frames++;
    if (p.time >= 5.5) {
      p.done = true;
      const fps = p.frames / 3;
      if (fps < SLOW_FPS) onSlow(Math.round(fps));
    }
  });
  return null;
}

/** Name plates and speech bubbles follow heads on screen; written straight to the DOM each frame. */
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
      const ppm = (camera as THREE.OrthographicCamera).isOrthographicCamera
        ? camera.zoom
        : size.height / Math.max(1, camera.position.distanceTo(at));
      const far = ppm < FAR_TAG_PPM ? '1' : '0';
      if (el.dataset['far'] !== far) el.dataset['far'] = far;
      v.copy(at)
        .setY(at.y + 0.25)
        .project(camera);
      const hidden = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
      el.style.visibility = hidden ? 'hidden' : 'visible';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 10_000));
    }
  });
  return null;
}

/** Jarvis in a meeting: a hologram of the reactor over the head of the table. */
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
  useFrame(({ clock }, dt) => {
    const p = seat ?? plan.core;
    const y = seat ? 1.35 + Math.sin(clock.elapsedTime * 2) * 0.05 : 1.45;
    if (orb.current) {
      orb.current.position.set(p.x, y, p.z);
      orb.current.rotation.y += dt;
    }
    const v = heads.get('jarvis') ?? new THREE.Vector3();
    heads.set('jarvis', v.set(p.x, y + (seat ? 0.3 : 1.0), p.z));
  });
  useEffect(() => () => void heads.delete('jarvis'), [heads]);
  return seat ? (
    <mesh ref={orb}>
      <icosahedronGeometry args={[0.24, 1]} />
      <meshBasicMaterial
        color={accent}
        wireframe
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  ) : null;
}

/** Night lighting: a cool fill, moonlight through the windows (with shadows), warm lamps elsewhere. */
function Lights({
  plan,
  day,
  shadows,
}: {
  plan: Plan;
  day: number;
  shadows: boolean;
}): React.JSX.Element {
  const c = plan.bounds.centre;
  const span = Math.max(
    plan.bounds.max.x - plan.bounds.min.x,
    plan.bounds.max.z - plan.bounds.min.z,
  );
  const target = useMemo(() => new THREE.Object3D(), []);
  const key = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = -span * 0.7;
    cam.right = span * 0.7;
    cam.top = span * 0.7;
    cam.bottom = -span * 0.7;
    cam.near = 1;
    cam.far = span * 4;
    cam.updateProjectionMatrix();
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0008;
    l.shadow.normalBias = 0.02;
  }, [span]);
  const moon = useMemo(
    () => new THREE.Color('#8ea6ff').lerp(new THREE.Color('#fff3e0'), day),
    [day],
  );
  return (
    <>
      <primitive object={target} position={[c.x, 0, c.z]} />
      <ambientLight intensity={0.5 + day * 0.4} color="#ffe9d6" />
      <hemisphereLight args={['#aebbe8', '#4d3c30', 0.9 + day * 0.4]} />
      <directionalLight
        ref={key}
        color={moon}
        intensity={0.9 + day * 1.2}
        position={[c.x + span * 0.35, span * 0.9, c.z - span * 0.55]}
        target={target}
        castShadow={shadows}
      />
    </>
  );
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
  quality,
  resetKey,
  tags,
  onFinished,
  onSlow,
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
  quality: Quality;
  resetKey: number;
  tags: React.RefObject<Map<string, HTMLDivElement>>;
  onFinished(npc: Npc, error: boolean): void;
  /** Set while the quality is automatic: called once if this PC can't keep up. */
  onSlow?: ((fps: number) => void) | undefined;
}): React.JSX.Element {
  const meetings = useNpcStore((s) => s.meetings);
  const handoffs = useNpcStore((s) => s.handoffs);
  const bubbles = useNpcStore((s) => s.bubbles);
  const running = meetings.find((m) => m.status === 'running') ?? null;
  const attendees = running?.attendees ?? null;
  const targets = useTargets(npcs, attendees, running?.id ?? null, plan);
  const stateOf = (n: Npc): NpcState => (n.enabled ? (states[n.id] ?? 'idle') : 'off');
  const deskCount = Math.max(...npcs.map((n) => n.desk + 1), npcs.length, 8);
  const owners = useMemo(
    () =>
      new Map(
        npcs.map((n) => [
          n.desk,
          {
            color: NPC_HEX[n.color],
            state: n.enabled ? (states[n.id] ?? 'idle') : 'off',
          },
        ]),
      ),
    [npcs, states],
  );
  const high = quality === 'high';

  // An NPC that stops working just finished a job: a burst here, a toast in the HUD.
  const [bursts, setBursts] = useState<BurstInfo[]>([]);
  const prev = useRef<Record<string, NpcState>>({});
  useEffect(() => {
    const now = Date.now();
    const done: BurstInfo[] = [];
    for (const n of npcs) {
      const was = prev.current[n.id];
      const is = stateOf(n);
      if (was === 'working' && is !== 'working' && is !== 'off') {
        const error = Boolean(bubbles[n.id]?.text.startsWith('⚠️'));
        done.push({ id: `${n.id}:${now}`, npc: n.id, at: now, error });
        onFinished(n, error);
      }
      prev.current[n.id] = is;
    }
    if (done.length) setBursts((b) => [...b.filter((x) => now - x.at < BURST_MS), ...done]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, npcs]);

  // Sir's tags start from where he stands: the deck's front edge, in front of the camera.
  useEffect(() => {
    heads.set('sir', new THREE.Vector3(plan.bounds.centre.x, 2.4, plan.bounds.max.z));
  }, [heads, plan]);

  const colorOf = (id: string): string =>
    id === 'jarvis' || id === 'sir'
      ? accent
      : NPC_HEX[npcs.find((n) => n.id === id)?.color ?? 'cyan'];

  return (
    <>
      <Environment background={SKY} />
      <Lights plan={plan} day={day} shadows={high} />
      <Room plan={plan} day={day} />
      <Workstations plan={plan} count={deskCount} owners={owners} />
      <PodLights plan={plan} count={deskCount} />
      <MeetingRoom plan={plan} active={Boolean(running)} />
      <JarvisTerminal plan={plan} accent={accent} busy={speaking.has('jarvis') && !running} />
      <Lounge plan={plan} />
      <Plants plan={plan} />
      {onSlow && <FpsProbe onSlow={onSlow} />}
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
            shadows={high}
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
      {high && <Bloom strength={0.35} />}
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
      style={{ '--npc': color, '--gem': STATE_GEM[state], visibility: 'hidden' } as CSSProperties}
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
        <span className="office3d-gem" aria-hidden />
        <span aria-hidden>{emoji}</span>
        <span className="office3d-label">{label}</span>
        {state === 'working' && (
          <span className="npc-typing text-accent-300" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        )}
        {state === 'off' && <span className="office3d-label text-ink-500">zz</span>}
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
  const [picked, setPicked] = useState<Quality | null>(savedQuality);
  // Automatic: start with the full look; FpsProbe drops to Performance if this PC can't keep up.
  const [auto, setAuto] = useState<Quality>('high');
  const quality: Quality = picked ?? auto;
  const [resetKey, setResetKey] = useState(0);
  const [accent] = useState(() => themeColor('--accent-500', '#22d3ee'));
  const heads = useMemo(() => new Map<string, THREE.Vector3>(), []);
  const tags = useRef(new Map<string, HTMLDivElement>());
  const highest = Math.max(-1, ...npcs.map((n) => n.desk));
  const plan = useMemo(() => planFor(npcs.length, highest), [npcs.length, highest]);
  const running = meetings.find((m) => m.status === 'running');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pickQuality = (q: Quality): void => {
    setPicked(q);
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      // not remembered
    }
  };

  // Re-render while hand-offs or speech are fresh so they expire on time.
  const [, tick] = useState(0);
  const live =
    handoffs.some((h) => Date.now() - h.at < HANDOFF_MS) || Object.keys(bubbles).length > 0;
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => {
    if (!toasts.length) return undefined;
    const t = setTimeout(() => setToasts((all) => all.slice(1)), TOAST_MS);
    return () => clearTimeout(t);
  }, [toasts]);

  const now = Date.now();
  const speaking = new Set(
    Object.entries(bubbles)
      .filter(([, b]) => now - b.at < BUBBLE_FRESH_MS)
      .map(([id]) => id),
  );
  const stateOf = (n: Npc): NpcState => (n.enabled ? (states[n.id] ?? 'idle') : 'off');
  const counts: Record<NpcState, number> = { working: 0, idle: 0, meeting: 0, off: 0 };
  for (const n of npcs) counts[stateOf(n)]++;
  const line = (id: string): string | null => {
    const b = bubbles[id];
    return b && now - b.at < BUBBLE_FRESH_MS ? b.text.replace(/[*_`#>]/g, '').slice(0, 160) : null;
  };
  const tagRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) tags.current.set(id, el);
    else tags.current.delete(id);
  };
  const onFinished = (n: Npc, error: boolean): void =>
    setToasts((all) =>
      [
        ...all,
        {
          id: `${n.id}:${Date.now()}`,
          title: error ? `${n.name} hit a wall` : `${n.name} completed a task`,
          text: error ? 'See the team chat for what went wrong.' : n.role,
          color: NPC_HEX[n.color],
          error,
        },
      ].slice(-3),
    );

  return (
    <div className="office3d relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-0" role="region" aria-label="Office">
        <Canvas
          key={quality}
          dpr={quality === 'high' ? [1, 1.75] : 1}
          shadows={quality === 'high' ? 'percentage' : false}
          gl={{ antialias: true, powerPreference: 'high-performance', toneMappingExposure: 0.95 }}
          orthographic
          camera={{ zoom: 40, position: [40, 40, 40], near: 0.1, far: 500 }}
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
            quality={quality}
            resetKey={resetKey}
            tags={tags}
            onFinished={onFinished}
            onSlow={
              picked === null && auto === 'high'
                ? (fps: number) => {
                    setAuto('low');
                    setToasts((all) => [
                      ...all,
                      {
                        id: `perf:${Date.now()}`,
                        title: 'Switched to Performance',
                        text: `${fps} frames a second here, so glow and shadows are off. The button at the top right brings them back.`,
                        color: accent,
                        error: false,
                      },
                    ]);
                  }
                : undefined
            }
          />
        </Canvas>
        <div className="office3d-vignette pointer-events-none absolute inset-0" aria-hidden />
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
      </div>

      {/* HUD: outside the Office region so the name plates stay the one way to each NPC there. */}
      <div className="pointer-events-none absolute top-3 left-3" style={{ zIndex: 20_000 }}>
        <div className="pointer-events-auto">
          <SquadPanel counts={counts} day={day} />
        </div>
      </div>
      <div
        className="absolute top-3 right-3 flex flex-col items-end gap-3"
        style={{ zIndex: 20_000 }}
      >
        <div className="flex gap-1.5">
          <button
            type="button"
            className="office3d-btn"
            onClick={() => setResetKey((k) => k + 1)}
            title="Back to the whole deck"
          >
            <Crosshair size={14} aria-hidden /> Reset view
          </button>
          <button
            type="button"
            className="office3d-btn"
            aria-pressed={quality === 'high'}
            onClick={() => pickQuality(quality === 'high' ? 'low' : 'high')}
            title={
              quality === 'high'
                ? 'Glow, reflections and shadows on. Click for a lighter mode on older PCs.'
                : 'Performance mode. Click for glow, reflections and shadows.'
            }
          >
            {quality === 'high' ? (
              <Sparkles size={14} aria-hidden />
            ) : (
              <Gauge size={14} aria-hidden />
            )}
            {quality === 'high' ? 'Cinematic' : 'Performance'}
          </button>
          <button
            type="button"
            className="office3d-btn"
            onClick={onClassic}
            title="The flat office (lightest)"
          >
            <LayoutGrid size={14} aria-hidden /> Classic
          </button>
        </div>
        <Minimap plan={plan} npcs={npcs} heads={heads} selected={selected} accent={accent} />
      </div>
      <Toasts toasts={toasts} />
      <PartyBar npcs={npcs} stateOf={stateOf} selected={selected} onSelect={onSelect} />
    </div>
  );
}
