import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcState } from '@shared/npcs';
import { along, pathLength, type P } from './layout';
import { GEO, GEO2, mat, newGlowMat, sharedGlow } from './materials';

/**
 * One agent (2.52, "Holo-Ops"): a small hover-bot in its NPC colour. A glossy capsule body, a white
 * helmet with a dark glass face and two glowing eyes that blink, floating hands, a thruster glow
 * underneath and a spinning state gem overhead (blue working, green at desk, gold in a meeting, grey
 * off). It glides and banks along its route instead of walking. Built from primitives; no model files.
 * Ideas from Pixel Agents (a pose per activity) and Agentshire (NPCs going to meetings); our own code.
 *
 * It writes its head position into `heads` every frame, for the name plates and the hand-off beams.
 */

const GLIDE_SPEED = 2.6;
const SCALE = 1.15;
/** Hover height of the body's centre (unscaled): seated over a stool, low when off, higher in flight. */
const HOVER = { seated: 0.66, off: 0.5, flying: 0.9 };
const HEAD_Y = 0.36;

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
  const float = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const handL = useRef<THREE.Mesh>(null);
  const handR = useRef<THREE.Mesh>(null);
  const gem = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const talk = useRef<THREE.Mesh>(null);
  const eyes = useRef<Array<THREE.Mesh | null>>([]);
  const thruster = useRef<THREE.Mesh>(null);

  // Materials this bot animates are its own; the rest are shared.
  const own = useMemo(
    () => ({
      eye: newGlowMat(color, 1),
      thrust: new THREE.MeshBasicMaterial({
        map: sharedGlow(),
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      gem: new THREE.MeshStandardMaterial({
        color: '#000000',
        emissive: STATE_GEM.idle,
        emissiveIntensity: 2.2,
        metalness: 0.2,
        roughness: 0.2,
      }),
      ring: newGlowMat(color, 0.9),
      talk: newGlowMat(color, 0),
    }),
    [color],
  );
  useEffect(() => () => Object.values(own).forEach((m) => m.dispose()), [own]);
  const off = state === 'off';
  const body = mat(off ? '#3a4255' : color, { metalness: 0.45, roughness: 0.38 });
  const shell = mat('#9aa7bb', { metalness: 0.55, roughness: 0.32 });
  const glass = mat('#04060b', { metalness: 0.9, roughness: 0.08 });
  const dark = mat('#1b2232', { roughness: 0.5, metalness: 0.4 });

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
    w.t = Math.min(w.t + dt * GLIDE_SPEED, w.len);
    const step = along(w.path, w.t);
    const flying = !step.done && w.len > 0.05;
    pos.current = step.at;
    const want = flying ? step.heading : target.facing;
    let turn = want - heading.current;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    heading.current += turn * Math.min(1, dt * (flying ? 9 : 5));
    g.position.set(step.at.x, 0, step.at.z);
    g.rotation.y = heading.current;

    // Hover: higher in flight, low and still when off, a gentle bob otherwise.
    const f = float.current;
    if (f) {
      const base = flying ? HOVER.flying : off ? HOVER.off : HOVER.seated;
      const bob = off ? 0 : Math.sin(time * 2.1) * 0.03 * k;
      f.position.y += (base + bob - f.position.y) * Math.min(1, dt * 6);
      // Bank into the glide; lean in to type; droop when off.
      const tilt = flying ? 0.22 : state === 'working' ? 0.12 : off ? 0.3 : 0;
      f.rotation.x += (tilt - f.rotation.x) * Math.min(1, dt * 5);
      f.rotation.z = flying ? Math.sin(time * 3) * 0.05 * k : 0;
    }

    // Hands: type, gesture while speaking, swing in flight, rest otherwise.
    const typing = state === 'working' && !flying;
    const hx = 0.27;
    const hy = typing
      ? 0.02 + Math.sin(time * 18) * 0.025 * k
      : speaking
        ? 0.06 + Math.sin(time * 6) * 0.06 * k
        : -0.04;
    const hz = typing ? 0.22 : speaking ? 0.14 : flying ? -0.08 : 0.06;
    if (handL.current) handL.current.position.set(-hx, hy, hz);
    if (handR.current)
      handR.current.position.set(
        hx,
        typing ? 0.02 + Math.sin(time * 18 + 1.6) * 0.025 * k : hy,
        hz,
      );

    // Head: look down at the screen while typing, look around when idle, sleep when off.
    if (head.current) {
      const nod = typing
        ? 0.22
        : off
          ? 0.45
          : speaking
            ? Math.sin(time * 7) * 0.08 * k
            : Math.sin(time * 0.8) * 0.04 * k;
      const look = state === 'idle' && !flying ? Math.sin(time * 0.45) * 0.55 * k : 0;
      head.current.rotation.x += (nod - head.current.rotation.x) * Math.min(1, dt * 6);
      head.current.rotation.y += (look - head.current.rotation.y) * Math.min(1, dt * 3);
    }

    // Eyes: blink now and then; shut when off.
    let open = off ? 0.15 : 1;
    if (!off && time > blinkAt.current) {
      open = 0.1;
      if (time > blinkAt.current + 0.12) blinkAt.current = time + 2.5 + Math.random() * 4;
    }
    for (const e of eyes.current) if (e) e.scale.y += (open - e.scale.y) * Math.min(1, dt * 30);
    own.eye.opacity = off ? 0.25 : typing ? 0.95 + Math.sin(time * 9) * 0.05 * k : 1;

    // Thruster and gem.
    if (thruster.current) {
      const t = off ? 0.15 : flying ? 1.6 : 0.85;
      thruster.current.scale.setScalar(0.55 * t + Math.sin(time * 14) * 0.03 * k);
      own.thrust.opacity = off ? 0.15 : 0.75;
    }
    if (gem.current) {
      gem.current.rotation.y += dt * (state === 'working' ? 3 : 1.2);
      gem.current.position.y = HEAD_Y + 0.5 + Math.sin(time * 2.4) * 0.04 * k;
    }
    own.gem.emissive.set(STATE_GEM[state]);
    own.gem.emissiveIntensity = off
      ? 0.6
      : state === 'working'
        ? 2.4 + Math.sin(time * 6) * 0.6 * k
        : 1.8;

    // Speaking: a sound ring swells round the head.
    if (talk.current) {
      const s = speaking ? (time * 1.4) % 1 : 0;
      talk.current.scale.setScalar(0.25 + s * 0.35);
      own.talk.opacity = speaking ? (1 - s) * 0.8 : 0;
    }
    if (ring.current) {
      ring.current.visible = selected;
      ring.current.rotation.z += dt * 1.2;
    }

    const v = heads.get(id) ?? new THREE.Vector3();
    v.set(step.at.x, ((f?.position.y ?? HOVER.seated) + HEAD_Y + 0.62) * SCALE, step.at.z);
    heads.set(id, v);
  });

  useEffect(() => () => void heads.delete(id), [heads, id]);

  const click = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group ref={root} onClick={click}>
      {/* contact shadow and selection ring stay on the floor */}
      <mesh geometry={GEO.plane} rotation-x={-Math.PI / 2} position={[0, 0.015, 0]} scale={0.9}>
        <meshBasicMaterial
          map={sharedGlow()}
          color="#000000"
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={ring}
        geometry={GEO2.torus}
        rotation-x={Math.PI / 2}
        position={[0, 0.03, 0]}
        scale={[0.5, 0.5, 2]}
        material={own.ring}
        visible={false}
      />
      <group scale={SCALE}>
        <group ref={float} position={[0, HOVER.seated, 0]}>
          <mesh geometry={GEO2.pill} material={body} castShadow={shadows} />
          <mesh
            geometry={GEO.box}
            material={own.eye}
            position={[0, 0.02, 0.165]}
            scale={[0.12, 0.018, 0.02]}
          />
          <mesh
            ref={thruster}
            geometry={GEO.plane}
            rotation-x={-Math.PI / 2}
            position={[0, -0.32, 0]}
            material={own.thrust}
          />
          <mesh
            geometry={GEO.cylinder}
            material={dark}
            position={[0, -0.3, 0]}
            scale={[0.08, 0.04, 0.08]}
          />
          <mesh ref={handL} geometry={GEO2.hand} material={body} castShadow={shadows} />
          <mesh ref={handR} geometry={GEO2.hand} material={body} castShadow={shadows} />
          <group ref={head} position={[0, HEAD_Y, 0]}>
            <mesh geometry={GEO2.headSphere} material={shell} castShadow={shadows} />
            <mesh geometry={GEO2.facePlate} material={glass} />
            {[-0.068, 0.068].map((x, i) => (
              <mesh
                key={x}
                ref={(m) => void (eyes.current[i] = m)}
                geometry={GEO2.eye}
                material={own.eye}
                position={[x, 0.015, 0.212]}
              />
            ))}
            <mesh
              geometry={GEO.cylinder}
              material={dark}
              position={[0, 0.25, 0]}
              scale={[0.012, 0.1, 0.012]}
            />
            <mesh geometry={GEO.sphere} material={own.eye} position={[0, 0.31, 0]} scale={0.028} />
            <mesh
              ref={talk}
              geometry={GEO2.thinTorus}
              material={own.talk}
              rotation-x={Math.PI / 2}
            />
          </group>
          <mesh
            ref={gem}
            geometry={GEO2.octa}
            material={own.gem}
            position={[0, HEAD_Y + 0.5, 0]}
            scale={[0.07, 0.1, 0.07]}
          />
        </group>
      </group>
    </group>
  );
}
