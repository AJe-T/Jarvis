import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcState } from '@shared/npcs';
import { windowSpan } from './furniture';
import { deskSpot, podCentre, type Plan } from './layout';
import { GEO, sharedGlow } from './materials';

/**
 * The small things that make the office feel alive (2.55): monitors that throw their colour onto the
 * desk, moonlight through the windows, a city that twinkles, a real wall clock, a meeting-room screen
 * that shows the topic and a timer, dust drifting in the lamp light, steam from the coffee mugs.
 * All painted light and a few hundred points: nothing here needs a graphics card.
 */

const DESK_TOP = 0.74;

/** Additive, untoned glow material (owned by the caller). */
function additive(
  opacity: number,
  map: THREE.Texture | null = sharedGlow(),
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Each lit screen throws a soft pool of its colour onto the desk; working screens flicker a little. */
export function MonitorGlow({
  plan,
  count,
  owners,
  reduced,
}: {
  plan: Plan;
  count: number;
  owners: Map<number, { color: string; state: NpcState }>;
  reduced: boolean;
}): React.JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => additive(0.9), []);
  useEffect(() => () => material.dispose(), [material]);
  const base = useMemo(() => {
    const out: Array<{ color: THREE.Color; k: number; working: boolean }> = [];
    for (let i = 0; i < count; i++) {
      const o = owners.get(i);
      const k =
        !o || o.state === 'off'
          ? 0
          : o.state === 'working'
            ? 0.55
            : o.state === 'meeting'
              ? 0.1
              : 0.25;
      out.push({
        color: new THREE.Color(o?.color ?? '#000000'),
        k,
        working: o?.state === 'working',
      });
    }
    return out;
  }, [count, owners]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const s = deskSpot(i, plan);
      // On the desk between the monitor and the keyboard, facing up.
      const dz = s.facing === 0 ? 0.05 : -0.05;
      o.position.set(s.desk.x, DESK_TOP + 0.004, s.desk.z + dz);
      o.rotation.set(-Math.PI / 2, 0, 0);
      o.scale.set(1.25, 0.75, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [plan, count]);
  const c = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    base.forEach((b, i) => {
      const flicker =
        b.working && !reduced
          ? 0.85 + Math.sin(t * 9 + i * 1.7) * 0.08 + Math.sin(t * 23 + i) * 0.05
          : 1;
      m.setColorAt(i, c.copy(b.color).multiplyScalar(b.k * flicker));
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh key={count} ref={ref} args={[GEO.plane, material, Math.max(count, 1)]} />;
}

/** Cool moonlight spilling from the windows across the floor. */
export function WindowLight({ plan, day }: { plan: Plan; day: number }): React.JSX.Element {
  const { from, to, z } = windowSpan(plan);
  const panes = Math.max(2, Math.round((to - from) / 1.4));
  const w = (to - from) / panes;
  const material = useMemo(() => additive(0.16), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.color.set(new THREE.Color('#5a78ff').lerp(new THREE.Color('#fff1d6'), day));
  }, [material, day]);
  return (
    <group>
      {Array.from({ length: panes }, (_, i) => (
        <mesh
          key={i}
          material={material}
          geometry={GEO.plane}
          rotation-x={-Math.PI / 2}
          // Slanted patches, as if the light comes in from high up and to the right.
          position={[from + (i + 0.5) * w + 0.35, 0.011, z + 1.5]}
          rotation-z={-0.18}
          scale={[w * 0.9, 2.6, 1]}
        />
      ))}
    </group>
  );
}

/** The city outside: red aircraft lights blinking on the towers and a plane drifting past. */
export function CityLife({ plan, reduced }: { plan: Plan; reduced: boolean }): React.JSX.Element {
  const { from, to, z } = windowSpan(plan);
  const blinks = useRef<Array<THREE.Mesh | null>>([]);
  const plane = useRef<THREE.Mesh>(null);
  const spots = useMemo(
    () =>
      [0.18, 0.47, 0.81].map((t, i) => ({ x: from + (to - from) * t, y: 2.05 + (i % 2) * 0.22 })),
    [from, to],
  );
  const material = useMemo(() => additive(1), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    blinks.current.forEach((b, i) => {
      if (b) b.visible = reduced || (t + i * 0.7) % 2.2 < 0.35;
    });
    if (plane.current) {
      const k = ((t * 0.035) % 1.2) - 0.1;
      plane.current.position.x = from + (to - from) * k;
      plane.current.visible = !reduced && k > 0 && k < 1 && Math.floor(t * 2.5) % 2 === 0;
    }
  });
  return (
    <group position={[0, 0, z + 0.02]}>
      {spots.map((s, i) => (
        <mesh
          key={i}
          ref={(m) => void (blinks.current[i] = m)}
          position={[s.x, s.y, 0]}
          geometry={GEO.plane}
          scale={0.09}
        >
          <meshBasicMaterial
            map={sharedGlow()}
            color="#ff3b3b"
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh
        ref={plane}
        position={[from, 2.25, 0]}
        geometry={GEO.plane}
        scale={0.07}
        material={material}
      />
    </group>
  );
}

function drawClock(g: CanvasRenderingContext2D, now: Date): void {
  const S = 256;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#f3efe7';
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 10, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1b1d22';
  g.lineWidth = 14;
  g.stroke();
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = i % 3 === 0 ? 86 : 94;
    g.lineWidth = i % 3 === 0 ? 7 : 4;
    g.beginPath();
    g.moveTo(S / 2 + Math.sin(a) * r1, S / 2 - Math.cos(a) * r1);
    g.lineTo(S / 2 + Math.sin(a) * 104, S / 2 - Math.cos(a) * 104);
    g.stroke();
  }
  const hand = (a: number, len: number, width: number, color: string): void => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.sin(a) * len, S / 2 - Math.cos(a) * len);
    g.stroke();
  };
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  hand(((h + m / 60) / 12) * Math.PI * 2, 58, 10, '#1b1d22');
  hand((m / 60) * Math.PI * 2, 86, 6, '#1b1d22');
  hand((now.getSeconds() / 60) * Math.PI * 2, 92, 2.5, '#d9482b');
  g.fillStyle = '#1b1d22';
  g.beginPath();
  g.arc(S / 2, S / 2, 8, 0, Math.PI * 2);
  g.fill();
}

/** A real clock on the left wall: the PC's own time. */
export function WallClock({ plan }: { plan: Plan }): React.JSX.Element | null {
  const { canvas, tex } = useMemo(() => {
    if (typeof document === 'undefined') return { canvas: null, tex: null };
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, tex: t };
  }, []);
  useEffect(() => {
    const g = canvas?.getContext('2d');
    if (!g || !tex) return undefined;
    const tick = (): void => {
      drawClock(g, new Date());
      tex.needsUpdate = true;
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      clearInterval(t);
      tex.dispose();
    };
  }, [canvas, tex]);
  if (!tex) return null;
  const { min } = plan.bounds;
  return (
    <group position={[min.x + 0.1, 1.95, min.z + 1.45]} rotation-y={Math.PI / 2}>
      <mesh geometry={CLOCK_GEO}>
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
const CLOCK_GEO = new THREE.CircleGeometry(0.3, 48);

function drawScreen(
  g: CanvasRenderingContext2D,
  accent: string,
  meeting: { topic: string; attendees: number; since: number } | null,
  now: Date,
): void {
  const W = 512;
  const H = 288;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b1020');
  bg.addColorStop(1, '#141a32');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = accent;
  g.fillRect(0, 0, W, 6);
  g.font = '600 20px "Segoe UI", system-ui, sans-serif';
  g.textBaseline = 'top';
  if (meeting) {
    g.fillStyle = '#fbbf24';
    g.beginPath();
    g.arc(34, 42, 7, 0, Math.PI * 2);
    g.fill();
    g.fillText('IN SESSION', 52, 31);
    g.fillStyle = '#ffffff';
    g.font = '700 34px "Segoe UI", system-ui, sans-serif';
    const topic = meeting.topic.length > 26 ? `${meeting.topic.slice(0, 25)}…` : meeting.topic;
    g.fillText(topic, 26, 92);
    g.fillStyle = '#9fb0d0';
    g.font = '500 22px "Segoe UI", system-ui, sans-serif';
    g.fillText(`${meeting.attendees} on the team · Jarvis leads`, 26, 146);
    const secs = Math.max(0, Math.floor((now.getTime() - meeting.since) / 1000));
    g.fillStyle = '#ffffff';
    g.font = '600 46px "Cascadia Mono", Consolas, monospace';
    g.fillText(
      `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`,
      26,
      200,
    );
  } else {
    g.fillStyle = '#34d399';
    g.beginPath();
    g.arc(34, 42, 7, 0, Math.PI * 2);
    g.fill();
    g.fillText('ROOM FREE', 52, 31);
    g.fillStyle = '#ffffff';
    g.font = '300 92px "Segoe UI", system-ui, sans-serif';
    g.fillText(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), 22, 92);
    g.fillStyle = '#9fb0d0';
    g.font = '500 22px "Segoe UI", system-ui, sans-serif';
    g.fillText(
      now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      26,
      210,
    );
  }
}

/** The meeting room's wall screen: the topic, who is there and a timer in session; the time otherwise. */
export function MeetingScreen({
  plan,
  accent,
  meeting,
}: {
  plan: Plan;
  accent: string;
  meeting: { topic: string; attendees: number; since: number } | null;
}): React.JSX.Element | null {
  const { canvas, tex } = useMemo(() => {
    if (typeof document === 'undefined') return { canvas: null, tex: null };
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, tex: t };
  }, []);
  useEffect(() => () => tex?.dispose(), [tex]);
  useEffect(() => {
    const g = canvas?.getContext('2d');
    if (!g || !tex) return undefined;
    const draw = (): void => {
      drawScreen(g, accent, meeting, new Date());
      tex.needsUpdate = true;
    };
    draw();
    const t = setInterval(draw, meeting ? 1000 : 15_000);
    return () => clearInterval(t);
  }, [canvas, tex, accent, meeting]);
  if (!tex) return null;
  const { x0, z0, size } = plan.room;
  return (
    <group position={[x0 + size / 2, 1.5, z0 + 0.09]}>
      <mesh geometry={GEO.box} scale={[1.74, 1.0, 0.04]} position={[0, 0, -0.02]}>
        <meshStandardMaterial color="#0d0f13" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh geometry={GEO.plane} scale={[1.64, 0.92, 1]} position={[0, 0, 0.002]}>
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Dust drifting slowly through the lamp light over the pods and the lounge. */
export function Dust({ plan, count }: { plan: Plan; count: number }): React.JSX.Element {
  const points = useMemo(() => {
    const pods = Math.max(1, Math.ceil(count / 4));
    const centres = [
      ...Array.from({ length: Math.min(pods, 6) }, (_, p) => podCentre(p, plan)),
      plan.lounge.centre,
    ];
    const n = centres.length * 26;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = centres[i % centres.length] ?? plan.bounds.centre;
      pos.set(
        [c.x + (Math.random() - 0.5) * 3, Math.random() * 2.3, c.z + (Math.random() - 0.5) * 3],
        i * 3,
      );
      seed[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: '#ffd9a8',
      size: 0.035,
      map: sharedGlow(),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { obj: new THREE.Points(g, m), seed };
  }, [plan, count]);
  useEffect(
    () => () => {
      points.obj.geometry.dispose();
      (points.obj.material as THREE.Material).dispose();
    },
    [points],
  );
  useFrame((_, dt) => {
    const a = points.obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      const s = points.seed[i] ?? 0;
      let y = a.getY(i) + dt * 0.05;
      if (y > 2.4) y = 0.2;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(y * 3 + s) * dt * 0.03);
    }
    a.needsUpdate = true;
  });
  return <primitive object={points.obj} />;
}

/** Wisps of steam curling up from the coffee mugs (on every third desk). */
export function MugSteam({ plan, count }: { plan: Plan; count: number }): React.JSX.Element {
  const PER = 7;
  const points = useMemo(() => {
    const mugs: THREE.Vector3[] = [];
    for (let d = 0; d < count; d += 3) {
      const s = deskSpot(d, plan);
      // The mug sits at (-0.55, top, 0.06) in the desk's own frame.
      const v = new THREE.Vector3(-0.55, DESK_TOP + 0.1, 0.06).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        s.facing,
      );
      mugs.push(v.add(new THREE.Vector3(s.desk.x, 0, s.desk.z)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(mugs.length * PER * 3), 3),
    );
    const m = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 0.05,
      map: sharedGlow(),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    return { obj: new THREE.Points(g, m), mugs };
  }, [plan, count]);
  useEffect(
    () => () => {
      points.obj.geometry.dispose();
      (points.obj.material as THREE.Material).dispose();
    },
    [points],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const a = points.obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    points.mugs.forEach((m, j) => {
      for (let k = 0; k < PER; k++) {
        const life = (t * 0.35 + k / PER + j * 0.13) % 1;
        a.setXYZ(
          j * PER + k,
          m.x + Math.sin(life * 6 + j) * 0.03,
          m.y + life * 0.32,
          m.z + Math.cos(life * 5 + k) * 0.02,
        );
      }
    });
    a.needsUpdate = true;
  });
  return <primitive object={points.obj} />;
}
