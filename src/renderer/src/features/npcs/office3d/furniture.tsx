import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { NpcState } from '@shared/npcs';
import { deskSpot, podCentre, POD_D, POD_W, seatAt, type Plan } from './layout';
import {
  cityTexture,
  codeTexture,
  COSY,
  edgeShadeTexture,
  GEO,
  GLASS,
  mat,
  rbox,
  sharedGlow,
} from './materials';

/**
 * The cosy office (2.54): an isometric cut-away office at night, in the style Sir chose (a dark room,
 * warm lamps, glass partitions, real-looking furniture, a city behind the windows). Everything is
 * modelled in code from rounded boxes, cylinders and spheres; no model files, nothing downloaded.
 *
 * Repeated furniture is drawn in **batches** (one instanced mesh per part), so 8 desks or 60 desks
 * cost the same handful of draw calls; light pools and the soft shade where floor meets wall are
 * painted gradients, not real lights, so a laptop's built-in graphics keeps up.
 */

const DESK_TOP = 0.74;
const WALL_H = 2.7;
const WALL_T = 0.16;

// ── batching ────────────────────────────────────────────────────────────────

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  m: THREE.Matrix4;
  shadow?: boolean;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
/** base × (translate · rotate · scale), as a new matrix. */
function at(
  base: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  ry = 0,
  rx = 0,
  s: [number, number, number] = [1, 1, 1],
): THREE.Matrix4 {
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    tmpQ.setFromEuler(tmpE.set(rx, ry, 0)),
    new THREE.Vector3(...s),
  );
  return base.clone().multiply(local);
}
const frameAt = (x: number, z: number, ry: number): THREE.Matrix4 =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
    new THREE.Vector3(1, 1, 1),
  );

function BatchMesh({
  geo,
  material,
  ms,
  shadow,
}: {
  geo: THREE.BufferGeometry;
  material: THREE.Material;
  ms: THREE.Matrix4[];
  shadow: boolean;
}): React.JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    ms.forEach((x, i) => m.setMatrixAt(i, x));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [ms]);
  return (
    <instancedMesh ref={ref} args={[geo, material, ms.length]} castShadow={shadow} receiveShadow />
  );
}

/** Many parts → one instanced mesh per (geometry, material). */
function Batch({ parts }: { parts: Part[] }): React.JSX.Element {
  const groups = useMemo(() => {
    const g = new Map<
      string,
      { geo: THREE.BufferGeometry; mat: THREE.Material; ms: THREE.Matrix4[]; shadow: boolean }
    >();
    for (const p of parts) {
      const key = `${p.geo.uuid}|${p.mat.uuid}`;
      const e = g.get(key) ?? { geo: p.geo, mat: p.mat, ms: [], shadow: Boolean(p.shadow) };
      e.ms.push(p.m);
      g.set(key, e);
    }
    return [...g.values()];
  }, [parts]);
  return (
    <>
      {groups.map((x) => (
        <BatchMesh
          key={`${x.geo.uuid}|${x.mat.uuid}|${x.ms.length}`}
          geo={x.geo}
          material={x.mat}
          ms={x.ms}
          shadow={x.shadow}
        />
      ))}
    </>
  );
}

// ── kits ────────────────────────────────────────────────────────────────────

const M = {
  wood: () => mat(COSY.wood, { roughness: 0.55 }),
  darkWood: () => mat(COSY.darkWood, { roughness: 0.6 }),
  metal: () => mat(COSY.metal, { roughness: 0.45, metalness: 0.5 }),
  chair: () => mat(COSY.chair, { roughness: 0.7 }),
  fabric: () => mat(COSY.fabric, { roughness: 0.95 }),
  black: () => mat('#0d0f13', { roughness: 0.3, metalness: 0.4 }),
  key: () => mat('#22262d', { roughness: 0.6 }),
  white: () => mat('#e9e6df', { roughness: 0.4 }),
  chrome: () => mat('#8b929c', { roughness: 0.3, metalness: 0.8 }),
};

/** An office chair at `base`, facing +z: five-star base with casters, gas lift, seat, back, arms. */
function chairParts(base: THREE.Matrix4, out: Part[]): void {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    out.push({
      geo: rbox(0.3, 0.03, 0.045, 0.012),
      mat: M.metal(),
      m: at(base, Math.sin(a) * 0.14, 0.07, Math.cos(a) * 0.14, a + Math.PI / 2),
    });
    out.push({
      geo: GEO.sphere,
      mat: M.black(),
      m: at(base, Math.sin(a) * 0.28, 0.03, Math.cos(a) * 0.28, 0, 0, [0.03, 0.03, 0.03]),
    });
  }
  out.push({
    geo: GEO.cylinder,
    mat: M.chrome(),
    m: at(base, 0, 0.25, 0, 0, 0, [0.025, 0.32, 0.025]),
  });
  out.push({
    geo: rbox(0.48, 0.08, 0.46, 0.035),
    mat: M.chair(),
    m: at(base, 0, 0.44, 0),
    shadow: true,
  });
  out.push({
    geo: rbox(0.45, 0.55, 0.06, 0.035),
    mat: M.chair(),
    m: at(base, 0, 0.8, -0.24, 0, -0.12),
    shadow: true,
  });
  for (const x of [-0.26, 0.26]) {
    out.push({ geo: rbox(0.05, 0.035, 0.26, 0.015), mat: M.chair(), m: at(base, x, 0.62, 0.02) });
    out.push({
      geo: GEO.box,
      mat: M.metal(),
      m: at(base, x, 0.53, 0.02, 0, 0, [0.025, 0.16, 0.025]),
    });
  }
}

/** A desk at `base` (its centre), the person sitting on the -z side: top, panels, drawers, monitor, keyboard. */
function deskParts(base: THREE.Matrix4, d: number, out: Part[]): void {
  out.push({
    geo: rbox(1.5, 0.05, 0.74, 0.015),
    mat: M.wood(),
    m: at(base, 0, DESK_TOP - 0.025, 0),
    shadow: true,
  });
  for (const x of [-0.7, 0.7])
    out.push({
      geo: rbox(0.04, DESK_TOP - 0.05, 0.66, 0.01),
      mat: M.metal(),
      m: at(base, x, (DESK_TOP - 0.05) / 2, 0),
    });
  out.push({
    geo: rbox(0.42, 0.58, 0.6, 0.02),
    mat: M.key(),
    m: at(base, d % 2 === 0 ? 0.42 : -0.42, 0.3, 0.02),
    shadow: true,
  });
  for (const y of [0.45, 0.25])
    out.push({
      geo: GEO.box,
      mat: M.chrome(),
      m: at(base, d % 2 === 0 ? 0.42 : -0.42, y, -0.29, 0, 0, [0.16, 0.012, 0.012]),
    });
  // monitor: stand, neck, body (the glowing screen is its own instanced layer)
  out.push({
    geo: rbox(0.22, 0.015, 0.16, 0.006),
    mat: M.black(),
    m: at(base, 0, DESK_TOP + 0.008, 0.2),
  });
  out.push({
    geo: GEO.box,
    mat: M.black(),
    m: at(base, 0, DESK_TOP + 0.15, 0.24, 0, 0, [0.04, 0.28, 0.03]),
  });
  out.push({
    geo: rbox(0.66, 0.4, 0.035, 0.012),
    mat: M.black(),
    m: at(base, 0, DESK_TOP + 0.36, 0.22),
    shadow: true,
  });
  out.push({
    geo: rbox(0.42, 0.016, 0.13, 0.006),
    mat: M.key(),
    m: at(base, -0.02, DESK_TOP + 0.009, -0.12),
  });
  out.push({
    geo: rbox(0.06, 0.02, 0.09, 0.009),
    mat: M.key(),
    m: at(base, 0.32, DESK_TOP + 0.01, -0.12),
  });
  if (d % 3 === 0)
    out.push({
      geo: GEO.cylinder,
      mat: M.white(),
      m: at(base, -0.55, DESK_TOP + 0.045, 0.06, 0, 0, [0.035, 0.09, 0.035]),
    });
}

/** A potted plant at `base`: a ceramic pot and a fan of leaves (`size` 1 = floor plant). */
function plantParts(base: THREE.Matrix4, size: number, out: Part[], seed: number): void {
  const s = size;
  out.push({
    geo: potGeo,
    mat: mat(COSY.pot, { roughness: 0.5 }),
    m: at(base, 0, 0.2 * s, 0, 0, 0, [s, s, s]),
    shadow: true,
  });
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + seed;
    const tilt = 0.35 + (k % 3) * 0.18;
    out.push({
      geo: leafGeo,
      mat: k % 2 ? mat(COSY.leaf, { roughness: 0.6 }) : mat(COSY.leafLight, { roughness: 0.6 }),
      m: at(
        base,
        Math.sin(a) * 0.08 * s,
        (0.45 + (k % 3) * 0.12) * s,
        Math.cos(a) * 0.08 * s,
        a,
        tilt,
        [s, s, s],
      ),
      shadow: true,
    });
  }
}
const potGeo = new THREE.CylinderGeometry(0.17, 0.13, 0.4, 20);
const SHADE_GEO = new THREE.CylinderGeometry(0.12, 0.2, 0.26, 20, 1, true);
const RING_GEO = new THREE.TorusGeometry(0.3, 0.012, 8, 64);
/** A leaf: a flattened, stretched sphere leaning out from its centre. */
const leafGeo = new THREE.SphereGeometry(1, 12, 8).scale(0.11, 0.3, 0.03).translate(0, 0.27, 0);

// ── the room ────────────────────────────────────────────────────────────────

export function Room({ plan, day }: { plan: Plan; day: number }): React.JSX.Element {
  const { min, max } = plan.bounds;
  const w = max.x - min.x;
  const d = max.z - min.z;
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const city = useMemo(() => cityTexture(), []);
  const shade = useMemo(() => edgeShadeTexture(), []);
  useEffect(
    () => () => {
      city?.dispose();
      shade?.dispose();
    },
    [city, shade],
  );
  const pane = useMemo(() => new THREE.MeshBasicMaterial({ map: city, toneMapped: false }), [city]);
  useEffect(() => () => pane.dispose(), [pane]);
  useEffect(() => {
    // Daylight washes the city out; at night it glows.
    pane.color.set(new THREE.Color('#ffffff').lerp(new THREE.Color('#9fc4ff'), day * 0.6));
  }, [day, pane]);

  const winFrom = Math.max(min.x + w * 0.42, plan.room.x0 - 2);
  const winTo = max.x - 0.5;
  const panes = Math.max(2, Math.round((winTo - winFrom) / 1.4));
  const paneW = (winTo - winFrom) / panes;

  const parts = useMemo(() => {
    const out: Part[] = [];
    const id = new THREE.Matrix4();
    // window mullions
    for (let i = 0; i <= panes; i++)
      out.push({
        geo: GEO.box,
        mat: mat(COSY.frame),
        m: at(id, winFrom + i * paneW, 1.45, min.z + WALL_T / 2 + 0.04, 0, 0, [0.06, 1.9, 0.06]),
      });
    for (const y of [0.5, 2.4])
      out.push({
        geo: GEO.box,
        mat: mat(COSY.frame),
        m: at(id, (winFrom + winTo) / 2, y, min.z + WALL_T / 2 + 0.04, 0, 0, [
          winTo - winFrom + 0.06,
          0.06,
          0.06,
        ]),
      });
    // glass railing along the open front and right sides
    const rail = (x0: number, z0: number, x1: number, z1: number): void => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ry = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      const posts = Math.max(1, Math.round(len / 1.6));
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        out.push({
          geo: GEO.box,
          mat: mat(COSY.frame),
          m: at(id, x0 + (x1 - x0) * t, 0.55, z0 + (z1 - z0) * t, 0, 0, [0.05, 1.1, 0.05]),
        });
      }
      out.push({
        geo: GEO.box,
        mat: mat(COSY.frame),
        m: at(id, (x0 + x1) / 2, 1.1, (z0 + z1) / 2, ry, 0, [len, 0.05, 0.05]),
      });
      out.push({
        geo: GEO.box,
        mat: GLASS,
        m: at(id, (x0 + x1) / 2, 0.55, (z0 + z1) / 2, ry, 0, [len, 1.05, 0.02]),
      });
    };
    rail(min.x, max.z, max.x, max.z);
    rail(max.x, min.z, max.x, max.z);
    // art frames on the back wall, left of the windows
    for (let i = 0; i < 2; i++) {
      const x = min.x + 1.6 + i * 1.3;
      if (x > winFrom - 0.8) break;
      out.push({
        geo: rbox(0.9, 0.65, 0.04, 0.01),
        mat: mat(COSY.frame),
        m: at(id, x, 1.7, min.z + WALL_T / 2 + 0.02),
      });
      out.push({
        geo: GEO.box,
        mat: mat(i ? '#3f6b5c' : '#6b4f3f', { roughness: 0.9 }),
        m: at(id, x, 1.7, min.z + WALL_T / 2 + 0.045, 0, 0, [0.78, 0.53, 0.01]),
      });
    }
    return out;
  }, [min.x, min.z, max.x, max.z, winFrom, winTo, panes, paneW]);

  return (
    <group>
      {/* floor */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[cx, 0, cz]}
        scale={[w, d, 1]}
        geometry={GEO.plane}
        receiveShadow
      >
        <meshStandardMaterial color={COSY.floor} roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh
        position={[cx, -0.16, cz]}
        scale={[w + 0.3, 0.3, d + 0.3]}
        geometry={GEO.box}
        material={mat('#1b1d22')}
      />
      {/* back and left walls, with lighter caps */}
      <mesh
        position={[cx, WALL_H / 2, min.z]}
        scale={[w + WALL_T, WALL_H, WALL_T]}
        geometry={GEO.box}
        material={mat(COSY.wall, { roughness: 0.9 })}
        receiveShadow
      />
      <mesh
        position={[min.x, WALL_H / 2, cz]}
        scale={[WALL_T, WALL_H, d]}
        geometry={GEO.box}
        material={mat(COSY.wall, { roughness: 0.9 })}
        receiveShadow
      />
      <mesh
        position={[cx, WALL_H + 0.01, min.z]}
        scale={[w + WALL_T, 0.02, WALL_T + 0.01]}
        geometry={GEO.box}
        material={mat(COSY.wallTop)}
      />
      <mesh
        position={[min.x, WALL_H + 0.01, cz]}
        scale={[WALL_T + 0.01, 0.02, d]}
        geometry={GEO.box}
        material={mat(COSY.wallTop)}
      />
      {/* windows onto the city */}
      {Array.from({ length: panes }, (_, i) => (
        <mesh
          key={i}
          position={[winFrom + (i + 0.5) * paneW, 1.45, min.z + WALL_T / 2 + 0.01]}
          scale={[paneW - 0.04, 1.86, 1]}
          geometry={GEO.plane}
          material={pane}
        />
      ))}
      {/* soft shade where the floor meets the walls */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[cx, 0.004, min.z + WALL_T / 2 + 0.45]}
        scale={[w, 0.9, 1]}
        geometry={GEO.plane}
      >
        <meshBasicMaterial map={shade} transparent depthWrite={false} />
      </mesh>
      {/* the same strip turned a quarter: dark side against the left wall */}
      <group position={[min.x + WALL_T / 2 + 0.45, 0.004, cz]} rotation-y={Math.PI / 2}>
        <mesh rotation-x={-Math.PI / 2} scale={[d, 0.9, 1]} geometry={GEO.plane}>
          <meshBasicMaterial map={shade} transparent depthWrite={false} />
        </mesh>
      </group>
      <Batch parts={parts} />
    </group>
  );
}

/** Every workstation: desks, chairs, pod dividers and rugs, batched; the screens are a live layer. */
export function Workstations({
  plan,
  count,
  owners,
}: {
  plan: Plan;
  count: number;
  /** Desk number → its NPC's colour and state (empty desks stay dark). */
  owners: Map<number, { color: string; state: NpcState }>;
}): React.JSX.Element {
  const pods = Math.ceil(count / 4);
  const parts = useMemo(() => {
    const out: Part[] = [];
    for (let i = 0; i < count; i++) {
      const s = deskSpot(i, plan);
      deskParts(frameAt(s.desk.x, s.desk.z, s.facing), i, out);
      chairParts(frameAt(s.chair.x, s.chair.z, s.facing), out);
    }
    const id = new THREE.Matrix4();
    for (let p = 0; p < pods; p++) {
      const c = podCentre(p, plan);
      out.push({
        geo: rbox(3.3, 0.42, 0.04, 0.015),
        mat: M.fabric(),
        m: at(id, c.x, DESK_TOP + 0.21, c.z),
        shadow: true,
      });
      out.push({
        geo: rbox(POD_W - 0.5, 0.012, POD_D - 1.2, 0.005),
        mat: mat(COSY.rug, { roughness: 1 }),
        m: at(id, c.x, 0.006, c.z),
      });
      if (p % 2 === 0) plantParts(frameAt(c.x + 1.95, c.z - 0.2, 0), 0.38, out, p);
    }
    return out;
  }, [plan, count, pods]);

  // Screens: one instanced layer; each screen's colour is its owner's colour, brightness its state.
  const screens = useRef<THREE.InstancedMesh>(null);
  const tex = useMemo(() => codeTexture(7), []);
  const screenMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    [tex],
  );
  useEffect(
    () => () => {
      tex?.dispose();
      screenMat.dispose();
    },
    [tex, screenMat],
  );
  useLayoutEffect(() => {
    const m = screens.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const s = deskSpot(i, plan);
      m.setMatrixAt(
        i,
        at(
          frameAt(s.desk.x, s.desk.z, s.facing),
          0,
          DESK_TOP + 0.36,
          0.2,
          Math.PI,
          0,
          [0.6, 0.34, 1],
        ),
      );
      const o = owners.get(i);
      const k =
        !o || o.state === 'off'
          ? 0.04
          : o.state === 'working'
            ? 1
            : o.state === 'meeting'
              ? 0.18
              : 0.42;
      c.set(o?.color ?? '#6aa0ff').multiplyScalar(k);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [plan, count, owners]);
  useFrame((_, dt) => {
    if (tex) tex.offset.y = (tex.offset.y + dt * 0.1) % 1;
  });

  return (
    <group>
      <Batch parts={parts} />
      <instancedMesh key={count} ref={screens} args={[GEO.plane, screenMat, Math.max(count, 1)]} />
    </group>
  );
}

/** The glass meeting room: wood floor, glass walls on black frames, a round table, a pendant lamp. */
export function MeetingRoom({ plan, active }: { plan: Plan; active: boolean }): React.JSX.Element {
  const { x0, z0, size, table, tableR, door } = plan.room;
  const h = 2.4;
  const lamp = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (lamp.current)
      lamp.current.intensity = active ? 7 + Math.sin(clock.elapsedTime * 2) * 0.6 : 4.5;
  });
  const parts = useMemo(() => {
    const out: Part[] = [];
    const id = new THREE.Matrix4();
    const gap = 1.1;
    const segs: Array<[number, number, number, number]> = [
      [x0, z0, x0 + size, z0],
      [x0, z0 + size, x0 + size, z0 + size],
      [x0 + size, z0, x0 + size, z0 + size],
      [x0, z0, x0, door.z - gap / 2],
      [x0, door.z + gap / 2, x0, z0 + size],
    ];
    for (const [ax, az, bx, bz] of segs) {
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
      out.push({
        geo: GEO.box,
        mat: GLASS,
        m: at(id, (ax + bx) / 2, h / 2, (az + bz) / 2, ry, 0, [len, h, 0.02]),
      });
      out.push({
        geo: GEO.box,
        mat: mat(COSY.frame),
        m: at(id, (ax + bx) / 2, h, (az + bz) / 2, ry, 0, [len, 0.05, 0.05]),
      });
      const posts = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        out.push({
          geo: GEO.box,
          mat: mat(COSY.frame),
          m: at(id, ax + (bx - ax) * t, h / 2, az + (bz - az) * t, 0, 0, [0.05, h, 0.05]),
        });
      }
    }
    // table: wood top on a pedestal
    out.push({
      geo: GEO.cylinder,
      mat: mat('#a77a52', { roughness: 0.45 }),
      m: at(id, table.x, 0.73, table.z, 0, 0, [tableR, 0.05, tableR]),
      shadow: true,
    });
    out.push({
      geo: GEO.cylinder,
      mat: M.metal(),
      m: at(id, table.x, 0.36, table.z, 0, 0, [0.12, 0.72, 0.12]),
    });
    out.push({
      geo: GEO.cylinder,
      mat: M.metal(),
      m: at(id, table.x, 0.02, table.z, 0, 0, [0.5, 0.04, 0.5]),
    });
    for (let i = 0; i < 8; i++) {
      const s = seatAt(i, 8, plan);
      chairParts(frameAt(s.x, s.z, s.facing), out);
    }
    // whiteboard on the back glass, and a plant in the corner
    out.push({
      geo: rbox(1.6, 0.9, 0.03, 0.01),
      mat: M.white(),
      m: at(id, x0 + size / 2, 1.5, z0 + 0.06),
    });
    plantParts(frameAt(x0 + size - 0.45, z0 + size - 0.45, 0), 0.9, out, 3);
    return out;
  }, [x0, z0, size, table, tableR, door, plan]);
  return (
    <group>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[x0 + size / 2, 0.008, z0 + size / 2]}
        scale={[size, size, 1]}
        geometry={GEO.plane}
        receiveShadow
      >
        <meshStandardMaterial color="#5d4636" roughness={0.6} />
      </mesh>
      <Batch parts={parts} />
      {/* pendant lamp over the table */}
      <mesh
        position={[table.x, 1.95, table.z]}
        geometry={GEO.cylinder}
        scale={[0.32, 0.18, 0.32]}
        material={mat('#1a1c20', { metalness: 0.5, roughness: 0.4 })}
      />
      <mesh position={[table.x, 1.84, table.z]} geometry={GEO.sphere} scale={0.09}>
        <meshBasicMaterial color={COSY.lamp} toneMapped={false} />
      </mesh>
      <mesh
        position={[table.x, 2.5, table.z]}
        geometry={GEO.cylinder}
        scale={[0.01, 1.1, 0.01]}
        material={M.black()}
      />
      <pointLight
        ref={lamp}
        color={COSY.lamp}
        intensity={4.5}
        distance={6}
        decay={1.6}
        position={[table.x, 1.75, table.z]}
      />
      <LightPool x={table.x} z={table.z} r={2.6} opacity={0.22} />
    </group>
  );
}

/** A painted pool of warm light on the floor (cheap: no real light). */
export function LightPool({
  x,
  z,
  r,
  opacity = 0.16,
  color = COSY.lamp,
}: {
  x: number;
  z: number;
  r: number;
  opacity?: number;
  color?: string;
}): React.JSX.Element {
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[x, 0.012, z]}
      scale={[r * 2, r * 2, 1]}
      geometry={GEO.plane}
    >
      <meshBasicMaterial
        map={sharedGlow()}
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Warm ceiling lights over the first few pods (real lights), with painted pools under every pod. */
export function PodLights({ plan, count }: { plan: Plan; count: number }): React.JSX.Element {
  const pods = Math.ceil(count / 4);
  return (
    <group>
      {Array.from({ length: pods }, (_, p) => {
        const c = podCentre(p, plan);
        return (
          <group key={p}>
            <LightPool x={c.x} z={c.z} r={2.4} opacity={0.24} />
            {p < 4 && (
              <pointLight
                color={COSY.lamp}
                intensity={7}
                distance={6.5}
                decay={1.4}
                position={[c.x, 2.4, c.z]}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

/** The lounge: a rug, a green sofa, a coffee table, a floor lamp and a bookshelf. */
export function Lounge({ plan }: { plan: Plan }): React.JSX.Element {
  const { centre, w, d } = plan.lounge;
  const parts = useMemo(() => {
    const out: Part[] = [];
    const base = frameAt(centre.x, centre.z, Math.PI);
    const sofa = mat(COSY.sofa, { roughness: 0.85 });
    const cushion = mat('#4f7f5c', { roughness: 0.9 });
    out.push({
      geo: rbox(Math.min(w, 3.4), 0.015, d - 0.6, 0.006),
      mat: mat('#4a4f5b', { roughness: 1 }),
      m: at(base, 0, 0.008, 0),
    });
    // sofa against the far side of the rug, facing the table
    out.push({
      geo: rbox(2.1, 0.38, 0.85, 0.08),
      mat: sofa,
      m: at(base, 0, 0.24, -0.75),
      shadow: true,
    });
    out.push({
      geo: rbox(2.1, 0.5, 0.22, 0.08),
      mat: sofa,
      m: at(base, 0, 0.58, -1.08),
      shadow: true,
    });
    for (const x of [-1.0, 1.0])
      out.push({
        geo: rbox(0.2, 0.52, 0.85, 0.07),
        mat: sofa,
        m: at(base, x, 0.3, -0.75),
        shadow: true,
      });
    for (const x of [-0.6, 0, 0.6])
      out.push({
        geo: rbox(0.6, 0.12, 0.62, 0.05),
        mat: cushion,
        m: at(base, x, 0.48, -0.7),
        shadow: true,
      });
    // oval coffee table with a book and a mug
    out.push({
      geo: GEO.cylinder,
      mat: M.darkWood(),
      m: at(base, 0, 0.36, 0.35, 0, 0, [0.55, 0.04, 0.32]),
      shadow: true,
    });
    for (const [x, z] of [
      [-0.3, 0.25],
      [0.3, 0.25],
      [-0.3, 0.45],
      [0.3, 0.45],
    ] as const)
      out.push({
        geo: GEO.cylinder,
        mat: M.metal(),
        m: at(base, x, 0.17, z, 0, 0, [0.02, 0.34, 0.02]),
      });
    out.push({
      geo: rbox(0.26, 0.04, 0.18, 0.01),
      mat: mat('#9c4a3a'),
      m: at(base, -0.12, 0.4, 0.33, 0.3),
    });
    out.push({
      geo: GEO.cylinder,
      mat: M.white(),
      m: at(base, 0.2, 0.42, 0.38, 0, 0, [0.04, 0.09, 0.04]),
    });
    // bookshelf at the rug's side, with books
    // Against the left wall, facing into the room (the camera sees its shelves, not its side).
    const shelf = frameAt(plan.bounds.min.x + 0.33, centre.z, Math.PI / 2);
    out.push({
      geo: GEO.box,
      mat: M.darkWood(),
      m: at(shelf, 0, 0.95, -0.16, 0, 0, [1.2, 1.9, 0.03]),
      shadow: true,
    });
    // An open shelf: sides and boards, the books standing in front of the back panel.
    for (const x of [-0.59, 0.59])
      out.push({
        geo: GEO.box,
        mat: M.darkWood(),
        m: at(shelf, x, 0.95, 0, 0, 0, [0.03, 1.9, 0.36]),
        shadow: true,
      });
    for (let row = 0; row <= 4; row++)
      out.push({
        geo: GEO.box,
        mat: M.darkWood(),
        m: at(shelf, 0, 0.12 + row * 0.44, 0, 0, 0, [1.16, 0.03, 0.34]),
      });
    const colours = ['#b44d3a', '#3a6fb4', '#d4a94a', '#4c8a5c', '#7a4fb4', '#e0d6c4'];
    for (let row = 0; row < 4; row++)
      for (let b = 0; b < 7; b++) {
        if ((row * 7 + b) % 5 === 3) continue;
        out.push({
          geo: GEO.box,
          mat: mat(colours[(row * 3 + b) % colours.length] ?? '#888888', { roughness: 0.8 }),
          m: at(shelf, -0.46 + b * 0.15, 0.29 + row * 0.44 - (b % 3) * 0.015, 0, 0, 0, [
            0.09,
            0.3 - (b % 3) * 0.03,
            0.24,
          ]),
        });
      }
    plantParts(at(base, -Math.min(w, 3.4) / 2 - 0.3, 0, -0.9), 1, out, 1);
    return out;
  }, [centre.x, centre.z, w, d, plan.bounds.min.x]);
  const lampX = centre.x - Math.min(w, 3.4) / 2 + 0.4;
  const lampZ = centre.z + 0.9;
  return (
    <group>
      <Batch parts={parts} />
      <mesh
        position={[lampX, 0.85, lampZ]}
        geometry={GEO.cylinder}
        scale={[0.015, 1.7, 0.015]}
        material={M.black()}
      />
      <mesh position={[lampX, 1.72, lampZ]} geometry={SHADE_GEO}>
        <meshStandardMaterial
          color="#f3e2c4"
          emissive={COSY.lamp}
          emissiveIntensity={1.2}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight
        color={COSY.lamp}
        intensity={4}
        distance={5}
        decay={1.6}
        position={[lampX, 1.6, lampZ]}
      />
      <LightPool x={lampX + 0.3} z={lampZ - 0.4} r={1.8} opacity={0.2} />
    </group>
  );
}

/** Floor plants in the corners. */
export function Plants({ plan }: { plan: Plan }): React.JSX.Element {
  const { min, max } = plan.bounds;
  const parts = useMemo(() => {
    const out: Part[] = [];
    const spots: Array<[number, number]> = [
      [min.x + 0.55, min.z + 0.55],
      [plan.room.x0 - 0.7, min.z + 0.55],
      [min.x + 0.55, max.z - 0.6],
      [max.x - 0.6, max.z - 0.6],
    ];
    spots.forEach(([x, z], i) => plantParts(frameAt(x, z, i), 1.15, out, i));
    return out;
  }, [min.x, min.z, max.x, max.z, plan.room.x0]);
  return <Batch parts={parts} />;
}

/** Jarvis's terminal: a sleek pedestal with a slowly turning core of light. */
export function JarvisTerminal({
  plan,
  accent,
  busy,
}: {
  plan: Plan;
  accent: string;
  busy: boolean;
}): React.JSX.Element {
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (ring.current) ring.current.rotation.z += dt * (busy ? 2 : 0.6);
    if (core.current)
      core.current.scale.setScalar(0.17 + Math.sin(clock.elapsedTime * (busy ? 6 : 2)) * 0.015);
  });
  const { x, z } = plan.core;
  return (
    <group position={[x, 0, z]}>
      <mesh
        geometry={rbox(0.7, 0.95, 0.7, 0.08)}
        material={mat('#3a404c', { metalness: 0.5, roughness: 0.35 })}
        position={[0, 0.475, 0]}
        castShadow
      />
      <mesh geometry={rbox(0.62, 0.02, 0.62, 0.01)} position={[0, 0.96, 0]}>
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
      <mesh ref={core} geometry={GEO.sphere} position={[0, 1.35, 0]} scale={0.17}>
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
      <mesh ref={ring} geometry={RING_GEO} position={[0, 1.35, 0]} rotation-x={1.2}>
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
      <pointLight
        color={accent}
        intensity={busy ? 4 : 2.2}
        distance={3.5}
        decay={1.6}
        position={[0, 1.3, 0]}
      />
      <LightPool x={0} z={0} r={1.4} opacity={0.18} color={accent} />
    </group>
  );
}
