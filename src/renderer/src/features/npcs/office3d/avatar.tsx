import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcState } from '@shared/npcs';
import { along, pathLength, type P } from './layout';
import { GEO, mat, rbox, sharedGlow } from './materials';

/**
 * One agent (2.54, the cosy office): a cube-headed robot in its NPC colour, with a dark screen face and
 * two glowing eyes that blink (shut when switched off), a small body, arms and legs. It walks its route
 * at a steady pace, sits in its office chair and plays its state: types when working, looks around
 * when idle, talks or listens in a meeting, slumps when off. A small light on its head shows the state
 * (blue working, green at desk, gold meeting, grey off). Built from rounded boxes; no model files.
 * Ideas from Pixel Agents (a pose per activity) and Agentshire (walking to meetings); our own code.
 *
 * It writes its head position into `heads` every frame, for the name plates and the hand-off beams.
 */

const WALK_SPEED = 1.6;
const SCALE = 1.1;
/** Hip height (unscaled): seated on the chair, or standing on the legs. */
const SEAT_Y = 0.44;
const STAND_Y = 0.36;

export const STATE_GEM: Record<NpcState, string> = {
  working: '#38bdf8',
  idle: '#34d399',
  meeting: '#fbbf24',
  off: '#64748b',
};

export interface AvatarTarget {
  /** Where it should end up, how it faces there, and the route that leads there. */
  spot: P;
  facing: number;
  route: P[];
  /** Changes whenever it has somewhere new to go. */
  key: string;
}

const HEAD = rbox(0.38, 0.33, 0.34, 0.07);
const FACE = rbox(0.3, 0.2, 0.02, 0.035);
const EYE = rbox(0.058, 0.08, 0.012, 0.022);
const TORSO = rbox(0.3, 0.3, 0.22, 0.07);
const LIMB = new THREE.CapsuleGeometry(0.045, 0.2, 4, 10);
const LEG = new THREE.CapsuleGeometry(0.05, 0.22, 4, 10);
const FOOT = rbox(0.09, 0.05, 0.14, 0.02);
const LED = new THREE.SphereGeometry(0.025, 12, 8);

export function Avatar({
  id,
  color,
  state,
  speaking,
  selected,
  target,
  heads,
  reduced,
  shadows,
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
  shadows: boolean;
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
  const eyes = useRef<Array<THREE.Mesh | null>>([]);
  const ring = useRef<THREE.Mesh>(null);

  const own = useMemo(
    () => ({
      eye: new THREE.MeshBasicMaterial({ color: '#e8f6ff', toneMapped: false }),
      led: new THREE.MeshBasicMaterial({ color: STATE_GEM.idle, toneMapped: false }),
      ring: new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    }),
    [color],
  );
  useEffect(() => () => Object.values(own).forEach((m) => m.dispose()), [own]);
  const off = state === 'off';
  const shell = mat(off ? '#5a606b' : color, { roughness: 0.5, metalness: 0.05 });
  const shade = mat(off ? '#454a53' : color, { roughness: 0.6, metalness: 0.05 });
  const face = mat('#0b0d12', { roughness: 0.15, metalness: 0.5 });
  const hand = mat('#d9dde3', { roughness: 0.5 });

  const walk = useRef<{ key: string; path: P[]; t: number; len: number } | null>(null);
  const pos = useRef<P>({ ...target.spot });
  const heading = useRef(target.facing);
  const phase = useMemo(() => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 100, [id]);
  const blinkAt = useRef(2 + (phase % 5));

  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const time = clock.elapsedTime + phase;
    const k = reduced ? 0 : 1;
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
    if (hips.current)
      hips.current.position.y +=
        ((seated ? SEAT_Y : STAND_Y) +
          (walking ? Math.abs(Math.sin(time * 9)) * 0.02 * k : 0) -
          hips.current.position.y) *
        Math.min(1, dt * 10);
    const swing = walking ? Math.sin(time * 9) * 0.6 : 0;
    // Seated: thighs forward over the chair, shins down.
    if (legL.current) legL.current.rotation.x = seated ? -1.45 : swing;
    if (legR.current) legR.current.rotation.x = seated ? -1.45 : -swing;

    const typing = state === 'working' && seated;
    let armX = walking ? -swing * 0.8 : -0.15;
    let lean = 0;
    let look = 0;
    let nod = 0;
    if (typing) {
      armX = -1.25 + Math.sin(time * 16) * 0.12 * k;
      lean = 0.1;
      nod = -0.18 + Math.sin(time * 2.5) * 0.04 * k;
    } else if (off && seated) {
      lean = 0.28;
      nod = -0.5;
      armX = -0.25;
    } else if (speaking && seated) {
      armX = -0.6 + Math.sin(time * 5) * 0.35 * k;
      nod = Math.sin(time * 6) * 0.07 * k;
    } else if (seated) {
      look = Math.sin(time * 0.45) * 0.5 * k;
      nod = Math.sin(time * 0.9) * 0.03 * k;
    }
    if (armL.current) armL.current.rotation.x = armX;
    if (armR.current)
      armR.current.rotation.x = typing
        ? -1.25 + Math.sin(time * 16 + 1.7) * 0.12 * k
        : walking
          ? swing * 0.8
          : armX;
    if (torso.current)
      torso.current.rotation.x += (lean - torso.current.rotation.x) * Math.min(1, dt * 5);
    if (head.current) {
      head.current.rotation.y += (look - head.current.rotation.y) * Math.min(1, dt * 3);
      head.current.rotation.x += (nod - head.current.rotation.x) * Math.min(1, dt * 6);
    }

    // Eyes: blink now and then; flat and dim when off.
    let open = off ? 0.18 : 1;
    if (!off && time > blinkAt.current) {
      open = 0.12;
      if (time > blinkAt.current + 0.12) blinkAt.current = time + 2.5 + Math.random() * 4;
    }
    for (const e of eyes.current) if (e) e.scale.y += (open - e.scale.y) * Math.min(1, dt * 30);
    own.eye.color.set(off ? '#4b5563' : speaking ? '#ffffff' : '#e8f6ff');
    own.led.color.set(STATE_GEM[state]);
    if (ring.current) {
      ring.current.visible = selected;
      ring.current.rotation.z += dt * 1.2;
    }

    const v = heads.get(id) ?? new THREE.Vector3();
    v.set(step.at.x, ((hips.current?.position.y ?? SEAT_Y) + 0.78) * SCALE, step.at.z);
    heads.set(id, v);
  });

  useEffect(() => () => void heads.delete(id), [heads, id]);

  const click = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group ref={root} onClick={click}>
      <mesh geometry={GEO.plane} rotation-x={-Math.PI / 2} position={[0, 0.015, 0]} scale={0.8}>
        <meshBasicMaterial
          map={sharedGlow()}
          color="#000000"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={ring}
        geometry={GEO.ring}
        rotation-x={-Math.PI / 2}
        position={[0, 0.02, 0]}
        scale={1.05}
        material={own.ring}
        visible={false}
      />
      <group scale={SCALE}>
        <group ref={hips} position={[0, SEAT_Y, 0]}>
          {[-0.08, 0.08].map((x, i) => (
            <group key={x} ref={i ? legR : legL} position={[x, 0, 0]}>
              <mesh geometry={LEG} material={shade} position={[0, -0.16, 0]} castShadow={shadows} />
              <mesh geometry={FOOT} material={face} position={[0, -0.33, 0.03]} />
            </group>
          ))}
          <group ref={torso}>
            <mesh geometry={TORSO} material={shade} position={[0, 0.17, 0]} castShadow={shadows} />
            <mesh
              geometry={rbox(0.16, 0.06, 0.01, 0.01)}
              material={face}
              position={[0, 0.2, 0.111]}
            />
            {[-1, 1].map((side) => (
              <group key={side} ref={side < 0 ? armL : armR} position={[side * 0.2, 0.28, 0]}>
                <mesh
                  geometry={LIMB}
                  material={shade}
                  position={[0, -0.13, 0]}
                  castShadow={shadows}
                />
                <mesh geometry={GEO.sphere} material={hand} position={[0, -0.27, 0]} scale={0.05} />
              </group>
            ))}
            <group ref={head} position={[0, 0.5, 0]}>
              <mesh geometry={HEAD} material={shell} castShadow={shadows} />
              <mesh geometry={FACE} material={face} position={[0, -0.005, 0.166]} />
              {[-0.065, 0.065].map((x, i) => (
                <mesh
                  key={x}
                  ref={(m) => void (eyes.current[i] = m)}
                  geometry={EYE}
                  material={own.eye}
                  position={[x, 0, 0.178]}
                />
              ))}
              <mesh geometry={LED} material={own.led} position={[0.12, 0.17, 0.08]} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
