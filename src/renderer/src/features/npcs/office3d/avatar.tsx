import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcState } from '@shared/npcs';
import { along, pathLength, type P } from './layout';
import { GEO, mat } from './materials';

/**
 * One agent in the office (2.51): a small low-poly figure with a glowing visor in its NPC colour,
 * built from primitives (no model files). Ideas from Pixel Agents (an activity per state: typing while
 * working, a sign when it waits) and Agentshire (NPCs walking between desk and meeting); our own code.
 *
 * It walks the route it is given at a steady pace and turns to where it is going; at the end it sits
 * (a chair or a meeting stool) and plays its state: typing while working, looking around when idle,
 * talking or listening in a meeting, slumped and dark when switched off. It writes its head position
 * into `heads` every frame, for the name tags and the hand-off packets.
 */

const WALK_SPEED = 2.4;
/** Figures a little larger than life, so they read at office scale. */
const SCALE = 1.25;
/** Hip height (unscaled): legs are 0.46 long, so standing feet touch the floor; seated hips rest on the chair. */
const SEAT_Y = 0.37;
const STAND_Y = 0.47;

export interface AvatarTarget {
  /** Where it should end up, how it faces there, and the route that leads there. */
  spot: P;
  facing: number;
  route: P[];
  /** Changes whenever it has somewhere new to go. */
  key: string;
}

export function Avatar({
  id,
  color,
  state,
  speaking,
  selected,
  target,
  heads,
  reduced,
  onSelect,
}: {
  id: string;
  color: string;
  state: NpcState;
  /** It said something in the last few seconds. */
  speaking: boolean;
  selected: boolean;
  target: AvatarTarget;
  heads: Map<string, THREE.Vector3>;
  reduced: boolean;
  onSelect(): void;
}): React.JSX.Element {
  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const visor = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: '#05070c', emissive: color, emissiveIntensity: 1 }),
    [color],
  );
  useEffect(() => () => visor.dispose(), [visor]);
  const body = mat(color, { roughness: 0.55, metalness: 0.15 });
  const dim = mat('#3a4255', { roughness: 0.8 });
  const shell = mat('#d9e2ef', { roughness: 0.45, metalness: 0.2 });
  const dark = mat('#1b2232', { roughness: 0.7 });
  const off = state === 'off';

  // The walk: a route from where it stands now to the new spot.
  const walk = useRef<{ key: string; path: P[]; t: number; len: number } | null>(null);
  const pos = useRef<P>({ ...target.spot });
  const heading = useRef(target.facing);
  const phase = useMemo(() => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 100, [id]);

  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const time = clock.elapsedTime + phase;
    // A new destination: walk the given route, starting from wherever it is now.
    if (walk.current?.key !== target.key) {
      const path = [pos.current, ...target.route.slice(1)];
      if (path.length < 2) path.push(target.spot);
      walk.current = { key: target.key, path, t: reduced ? Infinity : 0, len: pathLength(path) };
    }
    const w = walk.current;
    w.t = Math.min(w.t + dt * WALK_SPEED, w.len);
    const step = along(w.path, w.t);
    const walking = !step.done && w.len > 0.05;
    pos.current = step.at;
    const want = walking ? step.heading : target.facing;
    let turn = want - heading.current;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    heading.current += turn * Math.min(1, dt * (walking ? 10 : 6));
    g.position.set(step.at.x, 0, step.at.z);
    g.rotation.y = heading.current;

    const seated = !walking;
    const k = reduced ? 0 : 1;
    if (hips.current)
      hips.current.position.y +=
        ((seated ? SEAT_Y : STAND_Y) - hips.current.position.y) * Math.min(1, dt * 8);
    const swing = walking ? Math.sin(time * 10) * 0.7 : 0;
    if (legL.current) legL.current.rotation.x = seated ? -Math.PI / 2 : swing;
    if (legR.current) legR.current.rotation.x = seated ? -Math.PI / 2 : -swing;

    let armX = walking ? -swing * 0.6 : 0;
    let lean = 0;
    let look = 0;
    let nod = 0;
    if (seated) {
      if (state === 'working') {
        armX = -1.15 + Math.sin(time * 16) * 0.12 * k;
        lean = 0.12;
        nod = -0.12 + Math.sin(time * 3) * 0.04 * k;
      } else if (state === 'off') {
        lean = 0.35;
        nod = -0.45;
        armX = -0.3;
      } else if (state === 'meeting' && speaking) {
        armX = -0.5 + Math.sin(time * 5) * 0.35 * k;
        nod = Math.sin(time * 6) * 0.08 * k;
      } else {
        look = Math.sin(time * 0.45) * 0.5 * k;
        nod = Math.sin(time * 0.9) * 0.03 * k;
      }
    }
    if (armL.current) armL.current.rotation.x = armX;
    if (armR.current)
      armR.current.rotation.x =
        state === 'working' && seated
          ? -1.15 + Math.sin(time * 16 + 1.7) * 0.12 * k
          : walking
            ? swing * 0.6
            : armX;
    if (torso.current) {
      torso.current.rotation.x += (lean - torso.current.rotation.x) * Math.min(1, dt * 5);
      torso.current.scale.y = 1 + (state === 'off' ? 0 : Math.sin(time * 2) * 0.012 * k);
    }
    if (head.current) {
      head.current.rotation.y += (look - head.current.rotation.y) * Math.min(1, dt * 3);
      head.current.rotation.x += (nod - head.current.rotation.x) * Math.min(1, dt * 6);
    }
    const glow = off
      ? 0.05
      : state === 'working'
        ? 2 + Math.sin(time * 6) * 0.5 * k
        : speaking
          ? 2.2
          : 1;
    visor.emissiveIntensity += (glow - visor.emissiveIntensity) * Math.min(1, dt * 6);
    if (ring.current) {
      ring.current.visible = selected;
      ring.current.rotation.z += dt * 0.8;
    }

    // Head position (world) for the name tag and hand-offs.
    const v = heads.get(id) ?? new THREE.Vector3();
    v.set(step.at.x, ((hips.current?.position.y ?? STAND_Y) + 0.95) * SCALE, step.at.z);
    heads.set(id, v);
  });

  useEffect(() => () => void heads.delete(id), [heads, id]);

  const click = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group ref={root} onClick={click} scale={SCALE}>
      <mesh
        ref={ring}
        geometry={GEO.ring}
        rotation-x={-Math.PI / 2}
        position={[0, 0.02, 0]}
        visible={false}
      >
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>
      <group ref={hips} position={[0, STAND_Y, 0]}>
        <group ref={legL} position={[-0.09, 0, 0]}>
          <mesh geometry={GEO.leg} material={dark} position={[0, -0.22, 0]} />
        </group>
        <group ref={legR} position={[0.09, 0, 0]}>
          <mesh geometry={GEO.leg} material={dark} position={[0, -0.22, 0]} />
        </group>
        <group ref={torso}>
          <mesh geometry={GEO.capsule} material={off ? dim : body} position={[0, 0.3, 0]} />
          <mesh
            geometry={GEO.box}
            material={shell}
            position={[0, 0.36, 0.13]}
            scale={[0.2, 0.16, 0.05]}
          />
          <group ref={armL} position={[-0.23, 0.48, 0]}>
            <mesh geometry={GEO.arm} material={off ? dim : body} position={[0, -0.2, 0]} />
          </group>
          <group ref={armR} position={[0.23, 0.48, 0]}>
            <mesh geometry={GEO.arm} material={off ? dim : body} position={[0, -0.2, 0]} />
          </group>
          <group ref={head} position={[0, 0.78, 0]}>
            <mesh geometry={GEO.head} material={shell} />
            <mesh geometry={GEO.visor} material={visor} position={[0, 0.02, 0.06]} />
            <mesh
              geometry={GEO.cylinder}
              material={dark}
              position={[0, 0.17, 0]}
              scale={[0.015, 0.08, 0.015]}
            />
            <mesh geometry={GEO.sphere} material={visor} position={[0, 0.22, 0]} scale={0.03} />
          </group>
        </group>
      </group>
    </group>
  );
}
