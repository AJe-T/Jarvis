/**
 * The 3D office's floor plan (2.51), as plain numbers so it can be tested without WebGL. Units are
 * metres; y is up, the floor is the x/z plane.
 *
 * Desks come in **pods of four** (two facing pairs, like a real open-plan office: an idea from Hermes
 * Virtual Office's division rooms and Pixel Agents' desks, drawn our own way). Pods fill rows, so any
 * number of NPCs fits; desk number `d` always lands in the same place for a given pod width. To the
 * right of the work floor sits the glass meeting room, with Jarvis's core in front of it. NPCs walk
 * along the aisles between pods (never through a desk) to the room's door and their seat.
 */

export interface P {
  x: number;
  z: number;
}

export const POD_W = 4.6;
export const POD_D = 4.4;
/** Half the gap between a pod's edge and its centre: the aisle runs along it. */
const POD_HALF_D = POD_D / 2;
const DESK_DX = 0.9;
const DESK_DZ = 0.45;
const CHAIR_DZ = 1.15;
const MARGIN = 1.2;
const ROOM_SIZE = 6;
const TABLE_R = 1.25;
const SEAT_R = 1.95;
export const MAX_SEATS = 10;

export interface DeskSpot {
  /** The desk's centre (the monitor sits on it). */
  desk: P;
  /** Where the NPC sits. */
  chair: P;
  /** Rotation about y so the NPC faces its monitor (0 = facing +z). */
  facing: number;
  pod: number;
}

export interface Room {
  x0: number;
  z0: number;
  size: number;
  table: P;
  tableR: number;
  door: P;
}

export interface Plan {
  podsPerRow: number;
  rows: number;
  /** The work floor's far corner (x, z); it starts at (0, 0). */
  floor: P;
  room: Room;
  core: P;
  /** The lounge in front of the work floor: sofas round a coffee table. */
  lounge: { centre: P; w: number; d: number };
  /** The whole office, for the floor and the camera. */
  bounds: { min: P; max: P; centre: P };
}

/** Wider pods rows for bigger teams, so the office stays roughly square. */
export function podsPerRow(npcCount: number): number {
  if (npcCount <= 8) return 2;
  if (npcCount <= 24) return 3;
  return 4;
}

export function planFor(npcCount: number, highestDesk = 0): Plan {
  const perRow = podsPerRow(npcCount);
  const pods = Math.max(Math.ceil(Math.max(npcCount, highestDesk + 1) / 4), 2);
  const rows = Math.max(Math.ceil(pods / perRow), 1);
  const floor = { x: perRow * POD_W, z: rows * POD_D };
  const x0 = floor.x + MARGIN + 0.6;
  const z0 = MARGIN;
  const room: Room = {
    x0,
    z0,
    size: ROOM_SIZE,
    table: { x: x0 + ROOM_SIZE / 2, z: z0 + ROOM_SIZE / 2 },
    tableR: TABLE_R,
    // The door faces the work floor, halfway down the room's left wall.
    door: { x: x0, z: z0 + ROOM_SIZE / 2 },
  };
  const core = { x: x0 + ROOM_SIZE / 2, z: z0 + ROOM_SIZE + 1.3 };
  const loungeD = 3.4;
  const lounge = {
    centre: { x: floor.x / 2, z: floor.z + 0.8 + loungeD / 2 },
    w: Math.min(floor.x - 0.8, 6),
    d: loungeD,
  };
  const max = {
    x: x0 + ROOM_SIZE + MARGIN,
    z: Math.max(core.z + 1.0, lounge.centre.z + loungeD / 2, z0 + ROOM_SIZE) + MARGIN,
  };
  const min = { x: -MARGIN, z: -MARGIN };
  return {
    podsPerRow: perRow,
    rows,
    floor,
    room,
    core,
    lounge,
    bounds: { min, max, centre: { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 } },
  };
}

export function podCentre(pod: number, plan: Plan): P {
  return {
    x: (pod % plan.podsPerRow) * POD_W + POD_W / 2,
    z: Math.floor(pod / plan.podsPerRow) * POD_D + POD_D / 2,
  };
}

/** Desk `d`: pod d/4; in the pod, left/right and back/front pairs that face each other. */
export function deskSpot(d: number, plan: Plan): DeskSpot {
  const desk = Math.max(0, Math.floor(d));
  const pod = Math.floor(desk / 4);
  const i = desk % 4;
  const c = podCentre(pod, plan);
  const side = i % 2 === 0 ? -1 : 1;
  const front = i >= 2;
  return {
    pod,
    desk: { x: c.x + side * DESK_DX, z: c.z + (front ? DESK_DZ : -DESK_DZ) },
    chair: { x: c.x + side * DESK_DX, z: c.z + (front ? CHAIR_DZ : -CHAIR_DZ) },
    // Back row looks towards +z (the divider), front row towards -z.
    facing: front ? Math.PI : 0,
  };
}

/** Seat `i` of `of` around the meeting table; the last seat (head of the table) is Jarvis's. */
export function seatAt(i: number, of: number, plan: Plan): P & { facing: number } {
  const n = Math.min(Math.max(of, 1), MAX_SEATS);
  const a = (i / n) * Math.PI * 2 + Math.PI / 2;
  const x = plan.room.table.x + Math.cos(a) * SEAT_R;
  const z = plan.room.table.z + Math.sin(a) * SEAT_R;
  return { x, z, facing: Math.atan2(plan.room.table.x - x, plan.room.table.z - z) };
}

/**
 * From a desk chair to a meeting seat: out to the pod's aisle, along it to the corridor beside the
 * room, to the door, in, to the seat. Reverse it to walk back.
 */
export function routeToSeat(d: number, seat: P, plan: Plan): P[] {
  const s = deskSpot(d, plan);
  const c = podCentre(s.pod, plan);
  const aisleZ = s.chair.z < c.z ? c.z - POD_HALF_D : c.z + POD_HALF_D;
  const corridorX = plan.room.x0 - 0.8;
  const inside = { x: plan.room.x0 + 0.8, z: plan.room.door.z };
  return [
    s.chair,
    { x: s.chair.x, z: aisleZ },
    { x: corridorX, z: aisleZ },
    { x: corridorX, z: plan.room.door.z },
    inside,
    { x: seat.x, z: seat.z },
  ];
}

export const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Total length of a path. */
export function pathLength(path: P[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) n += dist(a, b);
  }
  return n;
}

/** The point `t` metres along a path (clamped), and the direction it is heading. */
export function along(path: P[], t: number): { at: P; heading: number; done: boolean } {
  let left = Math.max(0, t);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const len = dist(a, b);
    if (left <= len && len > 0) {
      const k = left / len;
      return {
        at: { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k },
        heading: Math.atan2(b.x - a.x, b.z - a.z),
        done: false,
      };
    }
    left -= len;
  }
  const last = path.at(-1) ?? { x: 0, z: 0 };
  const prev = path.at(-2) ?? last;
  return { at: last, heading: Math.atan2(last.x - prev.x, last.z - prev.z), done: true };
}

/**
 * How light it is in the office (0 night … 1 midday), from the PC's clock: an idea from Agentshire's
 * day/night cycle. Dawn 6–8, dusk 18–20.
 */
export function daylight(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  if (h < 6 || h >= 20) return 0;
  if (h < 8) return (h - 6) / 2;
  if (h >= 18) return (20 - h) / 2;
  return 1;
}
