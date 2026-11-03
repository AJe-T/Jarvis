import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcState } from '@shared/npcs';
import { deskSpot, podCentre, seatAt, type Plan } from './layout';
import {
  codeTexture,
  GEO,
  GEO2,
  glowMat,
  hexTexture,
  mat,
  newGlowMat,
  sharedGlow,
} from './materials';

/**
 * The world (2.52, "Holo-Ops"): a floating deck with glowing hex seams over a starfield; round work
 * islands with curved holo-screens and a hologram projector each; a domed war-room; Jarvis's arc
 * reactor; a round lounge. Built from code (lathes, tori, shapes), no model files. Bright parts are
 * additive or strongly emissive so the bloom pass makes them glow.
 */

const DECK_Y = 0;
const SEAT_TOP = 0.42;

function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** The floating deck: rounded slab, glowing hex seams, a light rim, and a glow underneath. */
export function Deck({ plan, accent }: { plan: Plan; accent: string }): React.JSX.Element {
  const { min, max } = plan.bounds;
  const w = max.x - min.x + 1;
  const d = max.z - min.z + 1;
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const { slab, rim, top, hex } = useMemo(() => {
    const shape = roundedRect(w, d, 2.2);
    const slab = new THREE.ExtrudeGeometry(shape, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 3,
      curveSegments: 24,
    });
    const pts = shape.getSpacedPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 320, 0.035, 8, true);
    const top = new THREE.ShapeGeometry(shape, 24);
    const hex = hexTexture();
    hex?.repeat.set(w / 3.2, d / 3.2);
    // ShapeGeometry UVs are in metres: scale them to 0..1 so the repeat above means tiles per deck.
    const uv = top.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (uv.getX(i) + w / 2) / w, (uv.getY(i) + d / 2) / d);
    return { slab, rim, top, hex };
  }, [w, d]);
  useEffect(
    () => () => {
      slab.dispose();
      rim.dispose();
      top.dispose();
      hex?.dispose();
    },
    [slab, rim, top, hex],
  );
  const seams = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (seams.current)
      seams.current.emissiveIntensity = 0.55 + Math.sin(clock.elapsedTime * 0.8) * 0.12;
  });
  return (
    <group position={[cx, DECK_Y, cz]}>
      {/* the slab: extruded down from the top face */}
      <mesh
        geometry={slab}
        material={mat('#0a0f1a', { metalness: 0.6, roughness: 0.45 })}
        rotation-x={Math.PI / 2}
        position={[0, -0.02, 0]}
        receiveShadow
      />
      <mesh geometry={top} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow>
        <meshStandardMaterial
          ref={seams}
          color="#04070d"
          metalness={0.4}
          roughness={0.5}
          emissive={accent}
          emissiveMap={hex}
          emissiveIntensity={0.55}
        />
      </mesh>
      <mesh geometry={rim} position={[0, 0.03, 0]} material={glowMat(accent, 0.95)} />
      <mesh geometry={rim} position={[0, -0.6, 0]} material={glowMat(accent, 0.35)} />
      {/* hover glow under the deck */}
      <mesh
        geometry={GEO.plane}
        rotation-x={-Math.PI / 2}
        position={[0, -1.4, 0]}
        scale={[w * 1.3, d * 1.3, 1]}
      >
        <meshBasicMaterial
          map={sharedGlow()}
          color={accent}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Stars around the deck and motes drifting up over it. */
export function Atmosphere({
  plan,
  accent,
  motes,
}: {
  plan: Plan;
  accent: string;
  motes: boolean;
}): React.JSX.Element {
  const c = plan.bounds.centre;
  const { stars, dust } = useMemo(() => {
    const n = 900;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      const r = 60 + Math.random() * 60;
      a.set(
        [Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r * 0.6 - 10, Math.sin(v) * Math.sin(u) * r],
        i * 3,
      );
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(a, 3));
    const stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: '#cfe8ff',
        size: 0.35,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        fog: false,
      }),
    );
    const m = 160;
    const b = new Float32Array(m * 3);
    const span = Math.max(
      plan.bounds.max.x - plan.bounds.min.x,
      plan.bounds.max.z - plan.bounds.min.z,
    );
    for (let i = 0; i < m; i++)
      b.set([(Math.random() - 0.5) * span, Math.random() * 4, (Math.random() - 0.5) * span], i * 3);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(b, 3));
    const dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        color: accent,
        size: 0.05,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        map: sharedGlow(),
      }),
    );
    return { stars, dust };
  }, [plan, accent]);
  useEffect(
    () => () => {
      for (const p of [stars, dust]) {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      }
    },
    [stars, dust],
  );
  useFrame((_, dt) => {
    stars.rotation.y += dt * 0.004;
    if (!motes) return;
    const pos = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.18;
      if (y > 4) y = 0;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  });
  return (
    <group>
      <primitive object={stars} position={[c.x, 0, c.z]} />
      {motes && <primitive object={dust} position={[c.x, 0, c.z]} />}
    </group>
  );
}

/** Work islands: a ring desk with a glowing rim, a hologram projector at the centre, hover stools. */
export function Islands({
  plan,
  count,
  accent,
}: {
  plan: Plan;
  count: number;
  accent: string;
}): React.JSX.Element {
  const pods = Math.ceil(count / 4);
  const holos = useRef<Array<THREE.Mesh | null>>([]);
  useFrame((_, dt) => {
    for (const h of holos.current) if (h) h.rotation.y += dt * 0.6;
  });
  return (
    <group>
      {Array.from({ length: pods }, (_, p) => {
        const c = podCentre(p, plan);
        return (
          <group key={p} position={[c.x, 0, c.z]}>
            <mesh
              geometry={GEO2.ringDesk}
              material={mat('#121a2a', { metalness: 0.55, roughness: 0.25 })}
              position={[0, 0.7, 0]}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={GEO2.torus}
              material={glowMat(accent, 0.85)}
              rotation-x={Math.PI / 2}
              position={[0, 0.77, 0]}
              scale={[0.98, 0.98, 1]}
            />
            <mesh
              geometry={GEO.cylinder}
              material={mat('#0c1220', { metalness: 0.7, roughness: 0.3 })}
              position={[0, 0.35, 0]}
              scale={[0.07, 0.7, 0.07]}
            />
            <mesh
              geometry={GEO.cylinder}
              material={mat('#0c1220', { metalness: 0.7, roughness: 0.3 })}
              position={[0, 0.74, 0]}
              scale={[0.22, 0.06, 0.22]}
            />
            <mesh
              geometry={GEO.cylinder}
              position={[0, 0.98, 0]}
              scale={[0.2, 0.42, 0.2]}
              material={glowMat(accent, 0.12)}
            />
            <mesh
              ref={(m) => void (holos.current[p] = m)}
              geometry={GEO2.octa}
              position={[0, 1.22, 0]}
              scale={0.13}
            >
              <meshBasicMaterial
                color={accent}
                wireframe
                transparent
                opacity={0.9}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          </group>
        );
      })}
      {Array.from({ length: count }, (_, d) => {
        const s = deskSpot(d, plan);
        return (
          <group key={d} position={[s.chair.x, 0, s.chair.z]}>
            <mesh
              geometry={GEO.cylinder}
              material={mat('#1d2740', { metalness: 0.4, roughness: 0.4 })}
              position={[0, SEAT_TOP, 0]}
              scale={[0.22, 0.06, 0.22]}
              castShadow
            />
            <mesh
              geometry={GEO.plane}
              rotation-x={-Math.PI / 2}
              position={[0, 0.02, 0]}
              scale={0.7}
            >
              <meshBasicMaterial
                map={sharedGlow()}
                color={accent}
                transparent
                opacity={0.25}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** A curved holo-screen in front of a seat: scrolls code while its NPC works. */
export function HoloScreen({
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
  useEffect(() => () => tex?.dispose(), [tex]);
  const m = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: tex,
        color: color ?? '#000000',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [tex, color],
  );
  useEffect(() => () => m.dispose(), [m]);
  const edge = useMemo(() => newGlowMat(color ?? '#000000', 0), [color]);
  useEffect(() => () => edge.dispose(), [edge]);
  useFrame((_, dt) => {
    const working = state === 'working';
    if (working && tex) tex.offset.y = (tex.offset.y + dt * 0.14) % 1;
    const target =
      !color || state === 'off' ? 0 : working ? 0.95 : state === 'meeting' ? 0.12 : 0.35;
    m.opacity += (target - m.opacity) * Math.min(1, dt * 4);
    edge.opacity = m.opacity * 0.9;
  });
  return (
    <group position={[s.chair.x, 1.02, s.chair.z]} rotation-y={s.facing}>
      <mesh geometry={GEO2.screen} material={m} />
      <mesh
        geometry={GEO.box}
        material={edge}
        position={[0, -0.19, 0.6]}
        scale={[0.5, 0.012, 0.012]}
      />
    </group>
  );
}

/** The war-room: a glowing floor ring, a wire dome, a round table with a hologram over it in session. */
export function WarRoom({
  plan,
  active,
  accent,
}: {
  plan: Plan;
  active: boolean;
  accent: string;
}): React.JSX.Element {
  const { table, tableR, size } = plan.room;
  const R = size / 2;
  const globe = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }, dt) => {
    if (globe.current) {
      globe.current.rotation.y += dt * (active ? 0.8 : 0.2);
      const k = active ? 1 : 0.35;
      globe.current.scale.setScalar(
        globe.current.scale.x + (k - globe.current.scale.x) * Math.min(1, dt * 3),
      );
    }
    if (ring.current)
      ring.current.opacity = active ? 0.7 + Math.sin(clock.elapsedTime * 3) * 0.25 : 0.35;
  });
  return (
    <group position={[table.x, 0, table.z]}>
      <mesh
        geometry={GEO.cylinder}
        material={mat('#0b1120', { metalness: 0.7, roughness: 0.3 })}
        position={[0, 0.03, 0]}
        scale={[R, 0.06, R]}
        receiveShadow
      />
      <mesh
        geometry={GEO2.torus}
        rotation-x={Math.PI / 2}
        position={[0, 0.07, 0]}
        scale={[R, R, 2]}
      >
        <meshBasicMaterial
          ref={ring}
          color={accent}
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={GEO2.dome} position={[0, 0.06, 0]} scale={[R, R * 0.85, R]}>
        <meshBasicMaterial
          color={accent}
          wireframe
          transparent
          opacity={0.07}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh
        geometry={GEO.cylinder}
        material={mat('#121a2a', { metalness: 0.6, roughness: 0.22 })}
        position={[0, 0.72, 0]}
        scale={[tableR, 0.07, tableR]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={GEO2.torus}
        material={glowMat(accent, 0.9)}
        rotation-x={Math.PI / 2}
        position={[0, 0.76, 0]}
        scale={[tableR, tableR, 1]}
      />
      <mesh
        geometry={GEO.cylinder}
        material={mat('#0c1220', { metalness: 0.7 })}
        position={[0, 0.36, 0]}
        scale={[0.2, 0.72, 0.2]}
      />
      <group ref={globe} position={[0, 1.5, 0]}>
        <mesh geometry={GEO.sphere} scale={0.42}>
          <meshBasicMaterial
            color={accent}
            wireframe
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh
          geometry={GEO2.thinTorus}
          rotation-x={Math.PI / 2}
          scale={0.6}
          material={glowMat(accent, 0.9)}
        />
        <mesh
          geometry={GEO2.thinTorus}
          rotation-x={1.1}
          rotation-y={0.5}
          scale={0.68}
          material={glowMat(accent, 0.6)}
        />
      </group>
      <mesh
        geometry={GEO.cylinder}
        position={[0, 1.1, 0]}
        scale={[0.35, 0.7, 0.35]}
        material={glowMat(accent, active ? 0.1 : 0.03)}
      />
      {Array.from({ length: 8 }, (_, i) => {
        const s = seatAt(i, 8, plan);
        return (
          <mesh
            key={i}
            geometry={GEO.cylinder}
            material={mat('#1d2740', { metalness: 0.4, roughness: 0.4 })}
            position={[s.x - table.x, SEAT_TOP, s.z - table.z]}
            scale={[0.22, 0.06, 0.22]}
            castShadow
          />
        );
      })}
    </group>
  );
}

/** Jarvis's arc reactor: a hex pedestal, three spinning rings, a blazing heart and a beam of light. */
export function Reactor({
  plan,
  accent,
  busy,
}: {
  plan: Plan;
  accent: string;
  busy: boolean;
}): React.JSX.Element {
  const rings = useRef<Array<THREE.Mesh | null>>([]);
  const heart = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    const speed = busy ? 2.2 : 0.7;
    const [a, b, c] = rings.current;
    if (a) a.rotation.x += dt * speed;
    if (b) b.rotation.y += dt * speed * 0.8;
    if (c) c.rotation.z += dt * speed * 1.2;
    if (heart.current)
      heart.current.scale.setScalar(0.26 + Math.sin(clock.elapsedTime * (busy ? 6 : 2)) * 0.03);
  });
  const { x, z } = plan.core;
  return (
    <group position={[x, 0, z]}>
      <mesh
        geometry={GEO2.hexagon}
        material={mat('#0c1220', { metalness: 0.8, roughness: 0.25 })}
        position={[0, 0.18, 0]}
        scale={[1, 0.36, 1]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={GEO2.hexagon}
        material={glowMat(accent, 0.3)}
        position={[0, 0.37, 0]}
        scale={[0.92, 0.01, 0.92]}
      />
      <group position={[0, 1.45, 0]}>
        <mesh ref={heart} geometry={GEO.sphere} scale={0.26}>
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh geometry={GEO.sphere} scale={0.42} material={glowMat(accent, 0.35)} />
        {[0.6, 0.78, 0.96].map((r, i) => (
          <mesh
            key={r}
            ref={(m) => void (rings.current[i] = m)}
            geometry={GEO2.torus}
            scale={[r, r, 1.4]}
            rotation={[i * 0.9, i * 0.5, 0]}
            material={glowMat(accent, 0.9 - i * 0.15)}
          />
        ))}
      </group>
      <mesh
        geometry={GEO.cylinder}
        position={[0, 4.5, 0]}
        scale={[0.08, 9, 0.08]}
        material={glowMat(accent, 0.25)}
      />
      <mesh geometry={GEO.plane} rotation-x={-Math.PI / 2} position={[0, 0.39, 0]} scale={3}>
        <meshBasicMaterial
          map={sharedGlow()}
          color={accent}
          transparent
          opacity={0.28}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight color={accent} intensity={busy ? 9 : 5} distance={8} position={[0, 1.5, 0]} />
    </group>
  );
}

/** The lounge: a glowing ring rug, two curved sofas, a round table and a floor lamp. */
export function Lounge({ plan, accent }: { plan: Plan; accent: string }): React.JSX.Element {
  const { centre, d } = plan.lounge;
  const sofa = useMemo(() => new THREE.TorusGeometry(1.0, 0.2, 12, 32, Math.PI * 0.6), []);
  useEffect(() => () => sofa.dispose(), [sofa]);
  const R = Math.min(d / 2, 1.7);
  return (
    <group position={[centre.x, 0, centre.z]}>
      <mesh
        geometry={GEO.cylinder}
        material={mat('#0e1626', { roughness: 0.95 })}
        position={[0, 0.012, 0]}
        scale={[R, 0.02, R]}
        receiveShadow
      />
      <mesh
        geometry={GEO2.torus}
        rotation-x={Math.PI / 2}
        position={[0, 0.03, 0]}
        scale={[R, R, 1]}
        material={glowMat(accent, 0.6)}
      />
      {[0, Math.PI].map((rot) => (
        <mesh
          key={rot}
          geometry={sofa}
          material={mat('#2a2f52', { roughness: 0.85 })}
          rotation={[-Math.PI / 2, 0, rot + Math.PI * 0.19]}
          position={[0, 0.3, 0]}
          castShadow
        />
      ))}
      <mesh
        geometry={GEO.cylinder}
        material={mat('#1a2436', { metalness: 0.6, roughness: 0.2 })}
        position={[0, 0.34, 0]}
        scale={[0.45, 0.05, 0.45]}
        castShadow
      />
      <mesh
        geometry={GEO2.torus}
        material={glowMat('#ffd9a0', 0.8)}
        rotation-x={Math.PI / 2}
        position={[0, 0.37, 0]}
        scale={[0.45, 0.45, 1]}
      />
    </group>
  );
}

/** Stylised plants: a pot and round glowing-tipped foliage. */
export function Plants({ plan }: { plan: Plan }): React.JSX.Element {
  const { min, max } = plan.bounds;
  const spots: Array<[number, number]> = [
    [min.x + 0.9, min.z + 0.9],
    [plan.room.x0 - 0.9, min.z + 0.9],
    [min.x + 0.9, max.z - 0.9],
    [max.x - 0.9, max.z - 0.9],
  ];
  return (
    <group>
      {spots.map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          <mesh
            geometry={GEO.cylinder}
            material={mat('#141b2c', { metalness: 0.5, roughness: 0.4 })}
            position={[0, 0.22, 0]}
            scale={[0.26, 0.44, 0.26]}
            castShadow
          />
          {(
            [
              [0, 0.85, 0, 0.36],
              [0.18, 0.7, 0.1, 0.24],
              [-0.15, 0.75, -0.12, 0.26],
            ] as const
          ).map(([px, py, pz, r]) => (
            <mesh key={`${px}`} geometry={GEO.sphere} position={[px, py, pz]} scale={r} castShadow>
              <meshStandardMaterial
                color="#0f5132"
                roughness={0.6}
                emissive="#34d399"
                emissiveIntensity={0.25}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
