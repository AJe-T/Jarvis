import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HANDOFF_MS, type Handoff } from '../../../stores/npc-store';
import { GEO } from './materials';

/**
 * What happens between people (2.51). A **hand-off**: when someone tags someone ("@Ledger what can we
 * spend?"), a glowing packet flies in an arc from one to the other (an idea from Hermes Virtual
 * Office, where the caller walks to the callee's desk; ours flies, so a busy office stays calm).
 * A **burst**: when an NPC finishes a job a ring and sparks rise from it (Agentshire's completion
 * fireworks, much smaller); red when the reply was a failure note.
 */

const TRAIL = 28;

/** A point on the arc from a to b, raised in the middle by how far apart they are. */
function arc(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const lift = 0.8 + a.distanceTo(b) * 0.25;
  out.lerpVectors(a, b, t);
  out.y += Math.sin(Math.PI * t) * lift;
  return out;
}

export function HandoffArc({
  h,
  heads,
  color,
}: {
  h: Handoff;
  heads: Map<string, THREE.Vector3>;
  color: string;
}): React.JSX.Element {
  const packet = useRef<THREE.Mesh>(null);
  // A dotted trail: WebGL lines are always one pixel thin, points keep their size.
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const m = new THREE.PointsMaterial({
      color: h.error ? '#fb7185' : color,
      size: 0.075,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return new THREE.Points(g, m);
  }, [color, h.error]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const a = heads.get(h.from);
    const b = heads.get(h.to);
    const age = (Date.now() - h.at) / HANDOFF_MS;
    const visible = Boolean(a && b) && age < 1;
    line.visible = visible;
    if (packet.current) packet.current.visible = visible;
    if (!a || !b || !visible) return;
    // The packet travels in the first 70%; then the trail fades.
    const t = Math.min(age / 0.7, 1);
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < TRAIL; i++) {
      arc(a, b, (i / (TRAIL - 1)) * t, tmp);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
    line.material.opacity = age < 0.7 ? 0.9 : 0.9 * (1 - (age - 0.7) / 0.3);
    if (packet.current) arc(a, b, t, packet.current.position);
  });
  return (
    <group>
      <primitive object={line} />
      <mesh ref={packet} geometry={GEO.sphere} scale={0.13}>
        <meshBasicMaterial color={h.error ? '#fb7185' : color} />
      </mesh>
    </group>
  );
}

export interface BurstInfo {
  id: string;
  npc: string;
  at: number;
  error: boolean;
}

const SPARKS = 18;
export const BURST_MS = 1200;

export function Burst({
  b,
  heads,
  color,
}: {
  b: BurstInfo;
  heads: Map<string, THREE.Vector3>;
  color: string;
}): React.JSX.Element {
  const ring = useRef<THREE.Mesh>(null);
  const tint = b.error ? '#fb7185' : color;
  const sparks = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const dirs = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) {
      const a = (i / SPARKS) * Math.PI * 2;
      dirs.set([Math.cos(a) * 0.6, 1 + (i % 3) * 0.35, Math.sin(a) * 0.6], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    const p = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: tint, size: 0.07, transparent: true }),
    );
    return { points: p, dirs };
  }, [tint]);
  useEffect(
    () => () => {
      sparks.points.geometry.dispose();
      (sparks.points.material as THREE.Material).dispose();
    },
    [sparks],
  );
  useFrame(() => {
    const at = heads.get(b.npc);
    const age = (Date.now() - b.at) / BURST_MS;
    const live = Boolean(at) && age < 1;
    sparks.points.visible = live;
    if (ring.current) ring.current.visible = live;
    if (!at || !live) return;
    if (ring.current) {
      ring.current.position.set(at.x, 0.05, at.z);
      ring.current.scale.setScalar(0.6 + age * 2.4);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 1 - age;
    }
    const pos = sparks.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SPARKS; i++) {
      const dx = sparks.dirs[i * 3] ?? 0;
      const dy = sparks.dirs[i * 3 + 1] ?? 0;
      const dz = sparks.dirs[i * 3 + 2] ?? 0;
      pos.setXYZ(i, at.x + dx * age, at.y - 0.3 + dy * age - age * age * 0.6, at.z + dz * age);
    }
    pos.needsUpdate = true;
    sparks.points.material.opacity = 1 - age;
  });
  return (
    <group>
      <primitive object={sparks.points} />
      <mesh ref={ring} geometry={GEO.ring} rotation-x={-Math.PI / 2}>
        <meshBasicMaterial color={tint} transparent opacity={1} />
      </mesh>
    </group>
  );
}

/** Small sizes shared with the tests. */
export const EFFECTS = { TRAIL, SPARKS };
