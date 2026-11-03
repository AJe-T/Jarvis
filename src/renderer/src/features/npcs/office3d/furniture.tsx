import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcState } from '@shared/npcs';
import { deskSpot, seatAt, type Plan } from './layout';
import { codeTexture, GEO, GLASS, gridTexture, mat } from './materials';

/**
 * The room around the team (2.51): a neon-grid floor, windows that follow the clock, desk pods with
 * chairs and monitors (a monitor scrolls code while its NPC works, glows softly when it is idle, and
 * is dark when nobody sits there or its NPC is off), the glass meeting room and Jarvis's core.
 */

const DESK_TOP = 0.74;

export function Floor({ plan, accent }: { plan: Plan; accent: string }): React.JSX.Element {
  const { min, max } = plan.bounds;
  const w = max.x - min.x;
  const d = max.z - min.z;
  const tex = useMemo(() => {
    const t = gridTexture(accent);
    t?.repeat.set(w, d);
    return t;
  }, [accent, w, d]);
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[(min.x + max.x) / 2, 0, (min.z + max.z) / 2]}
      scale={[w, d, 1]}
      geometry={GEO.plane}
    >
      <meshStandardMaterial map={tex} color="#ffffff" roughness={0.9} metalness={0.05} />
    </mesh>
  );
}

/** A low back wall and side wall with window panes: bright by day, city lights at night. */
export function Walls({ plan, day }: { plan: Plan; day: number }): React.JSX.Element {
  const { min, max } = plan.bounds;
  // One material for every pane, so day and night change them all.
  const pane = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#05080f', roughness: 0.2 }),
    [],
  );
  useEffect(() => () => pane.dispose(), [pane]);
  useLayoutEffect(() => {
    pane.emissive.set(new THREE.Color('#0b1a33').lerp(new THREE.Color('#9fd3ff'), day));
    pane.emissiveIntensity = 0.35 + day * 0.9;
  }, [day, pane]);
  const backW = max.x - min.x;
  const sideD = max.z - min.z;
  const panes = Math.max(3, Math.floor(backW / 3));
  return (
    <group>
      <mesh
        geometry={GEO.box}
        material={mat('#111a2b')}
        position={[(min.x + max.x) / 2, 1.3, min.z]}
        scale={[backW, 2.6, 0.12]}
      />
      <mesh
        geometry={GEO.box}
        material={mat('#111a2b')}
        position={[min.x, 1.3, (min.z + max.z) / 2]}
        scale={[0.12, 2.6, sideD]}
      />
      {Array.from({ length: panes }, (_, i) => (
        <mesh
          key={i}
          geometry={GEO.plane}
          position={[min.x + ((i + 0.5) * backW) / panes, 1.5, min.z + 0.07]}
          scale={[(backW / panes) * 0.8, 1.3, 1]}
          material={pane}
        />
      ))}
    </group>
  );
}

/** Every desk and chair as two instanced meshes: a big team costs two draw calls, not hundreds. */
export function Desks({ plan, count }: { plan: Plan; count: number }): React.JSX.Element {
  const tops = useRef<THREE.InstancedMesh>(null);
  const chairs = useRef<THREE.InstancedMesh>(null);
  const dividers = useRef<THREE.InstancedMesh>(null);
  const pods = Math.ceil(count / 4);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const s = deskSpot(i, plan);
      o.position.set(s.desk.x, DESK_TOP, s.desk.z);
      o.rotation.set(0, 0, 0);
      o.scale.set(1.5, 0.06, 0.78);
      o.updateMatrix();
      tops.current?.setMatrixAt(i, o.matrix);
      o.position.set(s.chair.x, 0.42, s.chair.z);
      o.rotation.set(0, s.facing, 0);
      o.scale.set(0.46, 0.08, 0.46);
      o.updateMatrix();
      chairs.current?.setMatrixAt(i, o.matrix);
    }
    for (let p = 0; p < pods; p++) {
      const a = deskSpot(p * 4, plan);
      o.position.set(
        a.desk.x + 0.9,
        DESK_TOP + 0.22,
        (a.desk.z + deskSpot(p * 4 + 2, plan).desk.z) / 2,
      );
      o.rotation.set(0, 0, 0);
      o.scale.set(3.4, 0.38, 0.04);
      o.updateMatrix();
      dividers.current?.setMatrixAt(p, o.matrix);
    }
    for (const m of [tops.current, chairs.current, dividers.current])
      if (m) m.instanceMatrix.needsUpdate = true;
  }, [plan, count, pods]);
  return (
    <group>
      <instancedMesh
        ref={tops}
        args={[GEO.box, mat('#1c2638', { roughness: 0.4, metalness: 0.3 }), Math.max(count, 1)]}
        count={count}
      />
      <instancedMesh
        ref={chairs}
        args={[GEO.box, mat('#2a3347', { roughness: 0.8 }), Math.max(count, 1)]}
        count={count}
      />
      <instancedMesh ref={dividers} args={[GEO.box, GLASS, Math.max(pods, 1)]} count={pods} />
    </group>
  );
}

/** One monitor, driven by its NPC's state. */
export function Monitor({
  plan,
  desk,
  color,
  state,
}: {
  plan: Plan;
  desk: number;
  color: string | null;
  state: NpcState | null;
}): React.JSX.Element {
  const s = deskSpot(desk, plan);
  const tex = useMemo(() => codeTexture(desk + 1), [desk]);
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    const m = screen.current;
    if (!m) return;
    const working = state === 'working';
    if (working && tex) tex.offset.y = (tex.offset.y + dt * 0.12) % 1;
    const target =
      !color || state === 'off' ? 0 : working ? 1.6 : state === 'meeting' ? 0.15 : 0.45;
    m.emissiveIntensity += (target - m.emissiveIntensity) * Math.min(1, dt * 4);
  });
  // The screen faces the chair: back row screens face -z, front row +z.
  const towardsChair = s.facing === 0 ? Math.PI : 0;
  const dz = s.facing === 0 ? 0.12 : -0.12;
  return (
    <group position={[s.desk.x, DESK_TOP, s.desk.z + dz]} rotation-y={towardsChair}>
      <mesh
        geometry={GEO.box}
        material={mat('#0d131f')}
        position={[0, 0.08, 0]}
        scale={[0.06, 0.16, 0.06]}
      />
      <mesh
        geometry={GEO.box}
        material={mat('#0d131f', { metalness: 0.4 })}
        position={[0, 0.33, 0]}
        scale={[0.66, 0.4, 0.035]}
      />
      <mesh geometry={GEO.plane} position={[0, 0.33, 0.019]} scale={[0.6, 0.34, 1]}>
        <meshStandardMaterial
          ref={screen}
          color="#02040a"
          emissive={color ?? '#000000'}
          emissiveMap={tex}
          emissiveIntensity={0}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}

/** The glass meeting room: four walls with a door gap, a round table and stools. */
export function MeetingRoom({
  plan,
  active,
  accent,
}: {
  plan: Plan;
  active: boolean;
  accent: string;
}): React.JSX.Element {
  const { x0, z0, size, table, tableR, door } = plan.room;
  const h = 2.4;
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ring.current)
      ring.current.emissiveIntensity = active
        ? 1.2 + Math.sin(clock.elapsedTime * 2.4) * 0.5
        : 0.25;
  });
  const gap = 1.2;
  const leftA = door.z - gap / 2 - z0;
  const leftB = z0 + size - (door.z + gap / 2);
  return (
    <group>
      {/* walls: back, front, right, and the left one split around the door */}
      <mesh
        geometry={GEO.box}
        material={GLASS}
        position={[x0 + size / 2, h / 2, z0]}
        scale={[size, h, 0.05]}
      />
      <mesh
        geometry={GEO.box}
        material={GLASS}
        position={[x0 + size / 2, h / 2, z0 + size]}
        scale={[size, h, 0.05]}
      />
      <mesh
        geometry={GEO.box}
        material={GLASS}
        position={[x0 + size, h / 2, z0 + size / 2]}
        scale={[0.05, h, size]}
      />
      <mesh
        geometry={GEO.box}
        material={GLASS}
        position={[x0, h / 2, z0 + leftA / 2]}
        scale={[0.05, h, leftA]}
      />
      <mesh
        geometry={GEO.box}
        material={GLASS}
        position={[x0, h / 2, z0 + size - leftB / 2]}
        scale={[0.05, h, leftB]}
      />
      <mesh
        geometry={GEO.cylinder}
        material={mat('#1a2436', { roughness: 0.35, metalness: 0.4 })}
        position={[table.x, 0.72, table.z]}
        scale={[tableR, 0.06, tableR]}
      />
      <mesh
        geometry={GEO.cylinder}
        material={mat('#0f1726')}
        position={[table.x, 0.36, table.z]}
        scale={[0.18, 0.72, 0.18]}
      />
      <mesh
        position={[table.x, 0.755, table.z]}
        rotation-x={-Math.PI / 2}
        scale={[tableR * 1.6, tableR * 1.6, 1]}
        geometry={GEO.ring}
      >
        <meshStandardMaterial
          ref={ring}
          color="#000000"
          emissive={accent}
          emissiveIntensity={0.25}
          transparent
          opacity={0.9}
        />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const s = seatAt(i, 8, plan);
        return (
          <mesh
            key={i}
            geometry={GEO.cylinder}
            material={mat('#2a3347')}
            position={[s.x, 0.42, s.z]}
            scale={[0.22, 0.08, 0.22]}
          />
        );
      })}
    </group>
  );
}

/** Jarvis's core: a pedestal with a slowly turning lattice around a glowing heart. */
export function Core({
  plan,
  accent,
  busy,
}: {
  plan: Plan;
  accent: string;
  busy: boolean;
}): React.JSX.Element {
  const lattice = useRef<THREE.Mesh>(null);
  const heart = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, dt) => {
    if (lattice.current) {
      lattice.current.rotation.y += dt * (busy ? 1.2 : 0.35);
      lattice.current.rotation.x += dt * 0.15;
    }
    if (heart.current)
      heart.current.emissiveIntensity =
        (busy ? 2.4 : 1.4) + Math.sin(clock.elapsedTime * (busy ? 5 : 1.6)) * 0.4;
  });
  const { x, z } = plan.core;
  return (
    <group position={[x, 0, z]}>
      <mesh
        geometry={GEO.cylinder}
        material={mat('#141d2e', { metalness: 0.6, roughness: 0.3 })}
        position={[0, 0.25, 0]}
        scale={[0.9, 0.5, 0.9]}
      />
      <mesh
        geometry={GEO.cylinder}
        material={mat('#0b111c', { emissive: accent, emissiveIntensity: 0.6 })}
        position={[0, 0.51, 0]}
        scale={[0.75, 0.02, 0.75]}
      />
      <mesh geometry={GEO.sphere} position={[0, 1.35, 0]} scale={0.28}>
        <meshStandardMaterial
          ref={heart}
          color="#000000"
          emissive={accent}
          emissiveIntensity={1.4}
        />
      </mesh>
      <mesh ref={lattice} geometry={GEO.ico} position={[0, 1.35, 0]} scale={0.55}>
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.5}
          wireframe
          transparent
          opacity={0.7}
        />
      </mesh>
      <pointLight color={accent} intensity={busy ? 6 : 3} distance={6} position={[0, 1.4, 0]} />
    </group>
  );
}

/** A few plants so it feels lived in. */
export function Plants({ plan }: { plan: Plan }): React.JSX.Element {
  const { min, max } = plan.bounds;
  const spots: Array<[number, number]> = [
    [min.x + 0.6, min.z + 0.6],
    [plan.room.x0 - 0.6, min.z + 0.6],
    [min.x + 0.6, max.z - 0.6],
    [max.x - 0.6, max.z - 0.6],
  ];
  return (
    <group>
      {spots.map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          <mesh
            geometry={GEO.cylinder}
            material={mat('#3a2f2a')}
            position={[0, 0.2, 0]}
            scale={[0.22, 0.4, 0.22]}
          />
          <mesh
            geometry={GEO.ico}
            material={mat('#1f7a4d', { roughness: 0.8 })}
            position={[0, 0.75, 0]}
            scale={[0.42, 0.55, 0.42]}
          />
        </group>
      ))}
    </group>
  );
}

/** The lounge: a rug, two sofas round a coffee table, and a floor lamp. */
export function Lounge({ plan, accent }: { plan: Plan; accent: string }): React.JSX.Element {
  const { centre, w, d } = plan.lounge;
  const sofa = mat('#283247', { roughness: 0.9 });
  const cushion = mat('#323d55', { roughness: 0.95 });
  return (
    <group position={[centre.x, 0, centre.z]}>
      <mesh
        geometry={GEO.plane}
        rotation-x={-Math.PI / 2}
        position={[0, 0.01, 0]}
        scale={[w, d, 1]}
      >
        <meshStandardMaterial color={accent} transparent opacity={0.08} roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[0, 0, side * (d / 2 - 0.55)]}
          rotation-y={side > 0 ? Math.PI : 0}
        >
          <mesh
            geometry={GEO.box}
            material={sofa}
            position={[0, 0.22, 0]}
            scale={[2.2, 0.44, 0.8]}
          />
          <mesh
            geometry={GEO.box}
            material={cushion}
            position={[0, 0.5, -0.32]}
            scale={[2.2, 0.55, 0.18]}
          />
          <mesh
            geometry={GEO.box}
            material={sofa}
            position={[-1.15, 0.4, 0]}
            scale={[0.14, 0.36, 0.8]}
          />
          <mesh
            geometry={GEO.box}
            material={sofa}
            position={[1.15, 0.4, 0]}
            scale={[0.14, 0.36, 0.8]}
          />
        </group>
      ))}
      <mesh
        geometry={GEO.cylinder}
        material={mat('#1a2436', { metalness: 0.4, roughness: 0.3 })}
        position={[0, 0.36, 0]}
        scale={[0.6, 0.04, 0.6]}
      />
      <mesh
        geometry={GEO.cylinder}
        material={mat('#0f1726')}
        position={[0, 0.18, 0]}
        scale={[0.08, 0.36, 0.08]}
      />
      <mesh
        geometry={GEO.cylinder}
        material={mat('#e7ecf5', { roughness: 0.4 })}
        position={[0.15, 0.43, 0.05]}
        scale={[0.05, 0.1, 0.05]}
      />
      <group position={[w / 2 - 0.3, 0, 0]}>
        <mesh
          geometry={GEO.cylinder}
          material={mat('#0f1726')}
          position={[0, 0.8, 0]}
          scale={[0.025, 1.6, 0.025]}
        />
        <mesh geometry={GEO.sphere} position={[0, 1.65, 0]} scale={0.14}>
          <meshStandardMaterial color="#000000" emissive="#ffd9a0" emissiveIntensity={1.6} />
        </mesh>
        <pointLight color="#ffd9a0" intensity={2.5} distance={4} position={[0, 1.5, 0]} />
      </group>
    </group>
  );
}
