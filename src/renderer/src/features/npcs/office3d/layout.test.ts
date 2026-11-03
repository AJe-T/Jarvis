import { describe, expect, it } from 'vitest';
import {
  along,
  daylight,
  deskSpot,
  pathLength,
  planFor,
  podCentre,
  POD_D,
  POD_W,
  routeToSeat,
  seatAt,
  type P,
} from './layout';

const inPod = (p: P, c: P): boolean => Math.abs(p.x - c.x) < 1.6 && Math.abs(p.z - c.z) < 1.0;

describe('3D office floor plan (2.51)', () => {
  it('gives every desk its own place, for any team size', () => {
    for (const n of [0, 1, 4, 9, 30, 60]) {
      const plan = planFor(n, n - 1);
      const seen = new Set<string>();
      for (let d = 0; d < Math.max(n, 1); d++) {
        const s = deskSpot(d, plan);
        const key = `${s.chair.x.toFixed(2)},${s.chair.z.toFixed(2)}`;
        expect(seen.has(key), `desk ${d} of ${n}`).toBe(false);
        seen.add(key);
        // Everything stays on the work floor, left of the meeting room.
        expect(s.desk.x).toBeLessThan(plan.room.x0);
        expect(s.desk.z).toBeLessThan(plan.floor.z);
      }
    }
  });

  it('round islands of four: each NPC faces its screen and the island centre', () => {
    const plan = planFor(4);
    const c = podCentre(0, plan);
    const spots = [0, 1, 2, 3].map((i) => deskSpot(i, plan));
    const dirs = new Set<string>();
    for (const s of spots) {
      expect(s.pod).toBe(0);
      // On the seat circle, with the screen between the seat and the centre.
      expect(Math.hypot(s.chair.x - c.x, s.chair.z - c.z)).toBeCloseTo(1.32);
      expect(Math.hypot(s.desk.x - c.x, s.desk.z - c.z)).toBeCloseTo(0.74);
      // Facing points at the centre.
      expect(s.chair.x + Math.sin(s.facing) * 1.32).toBeCloseTo(c.x);
      expect(s.chair.z + Math.cos(s.facing) * 1.32).toBeCloseTo(c.z);
      dirs.add(`${Math.sign(s.chair.x - c.x)},${Math.sign(s.chair.z - c.z)}`);
    }
    expect(dirs.size).toBe(4);
    expect(deskSpot(4, plan).pod).toBe(1);
  });

  it('bigger teams get wider rows so the office stays roughly square', () => {
    expect(planFor(6).podsPerRow).toBe(2);
    expect(planFor(20).podsPerRow).toBe(3);
    expect(planFor(40).podsPerRow).toBe(4);
    const big = planFor(40);
    expect(big.floor.x).toBe(4 * POD_W);
    expect(big.floor.z).toBe(big.rows * POD_D);
  });

  it('the lounge sits in front of the work floor, clear of desks and the meeting room', () => {
    for (const n of [3, 12, 40]) {
      const plan = planFor(n, n - 1);
      const l = plan.lounge;
      expect(l.centre.z - l.d / 2).toBeGreaterThan(plan.floor.z);
      expect(l.centre.x + l.w / 2).toBeLessThan(plan.room.x0);
      expect(l.centre.z + l.d / 2).toBeLessThan(plan.bounds.max.z);
    }
  });

  it('meeting seats sit around the table, facing it', () => {
    const plan = planFor(6);
    for (let i = 0; i < 7; i++) {
      const s = seatAt(i, 7, plan);
      expect(Math.hypot(s.x - plan.room.table.x, s.z - plan.room.table.z)).toBeCloseTo(1.95);
      // Facing points at the table centre.
      const fx = s.x + Math.sin(s.facing);
      const fz = s.z + Math.cos(s.facing);
      expect(Math.hypot(fx - plan.room.table.x, fz - plan.room.table.z)).toBeLessThan(1.95);
      // Inside the room.
      expect(s.x).toBeGreaterThan(plan.room.x0);
      expect(s.x).toBeLessThan(plan.room.x0 + plan.room.size);
    }
  });

  it('walks along aisles to the door, never through another pod', () => {
    const plan = planFor(16);
    const seat = seatAt(0, 3, plan);
    for (let d = 0; d < 16; d++) {
      const path = routeToSeat(d, seat, plan);
      expect(path[0]).toEqual(deskSpot(d, plan).chair);
      expect(path.at(-1)).toEqual({ x: seat.x, z: seat.z });
      expect(path).toContainEqual({ x: plan.room.x0 + 0.8, z: plan.room.door.z });
      // Every turning point between the chair and the room is clear of all pods' desks.
      for (const p of path.slice(1, -2))
        for (let pod = 0; pod < 4; pod++) expect(inPod(p, podCentre(pod, plan))).toBe(false);
    }
  });

  it('moves along a path at a steady pace and stops at the end', () => {
    const path = [
      { x: 0, z: 0 },
      { x: 0, z: 2 },
      { x: 3, z: 2 },
    ];
    expect(pathLength(path)).toBe(5);
    expect(along(path, 1)).toMatchObject({ at: { x: 0, z: 1 }, done: false });
    expect(along(path, 1).heading).toBeCloseTo(0);
    expect(along(path, 3.5).at).toEqual({ x: 1.5, z: 2 });
    expect(along(path, 3.5).heading).toBeCloseTo(Math.PI / 2);
    expect(along(path, 99)).toMatchObject({ at: { x: 3, z: 2 }, done: true });
  });

  it('follows the clock: dark at night, light by day, a ramp at dawn and dusk', () => {
    expect(daylight(2)).toBe(0);
    expect(daylight(7)).toBeCloseTo(0.5);
    expect(daylight(13)).toBe(1);
    expect(daylight(19)).toBeCloseTo(0.5);
    expect(daylight(23.5)).toBe(0);
  });
});
