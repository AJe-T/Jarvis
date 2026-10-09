import { describe, expect, it } from 'vitest';
import {
  blobPath,
  clusterLayout,
  convexHull,
  folderTree,
  sphereLayout,
  squarify,
} from './brain-layout';

const note = (id: string, size = 100) => ({
  id,
  title: id.split('/').pop() ?? id,
  group: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.',
  size,
});

describe('brain layouts', () => {
  it('builds the folder tree with counts', () => {
    const t = folderTree([
      note('Memory/People/A.md'),
      note('Memory/People/B.md'),
      note('Memory/C.md'),
      note('Root.md'),
      { id: 'folder:Memory', title: 'Memory', group: 'folder', size: 0 },
    ]);
    expect(t.count).toBe(4);
    expect(t.notes.map((n) => n.id)).toEqual(['Root.md']);
    expect(t.folders[0]?.name).toBe('Memory');
    expect(t.folders[0]?.folders[0]?.count).toBe(2);
  });

  it('squarifies boxes that fill the area exactly', () => {
    const r = squarify(
      [
        { value: 6 },
        { value: 6 },
        { value: 4 },
        { value: 3 },
        { value: 2 },
        { value: 2 },
        { value: 1 },
      ],
      { x: 0, y: 0, w: 6, h: 4 },
    );
    expect(r).toHaveLength(7);
    expect(r.reduce((s, x) => s + x.w * x.h, 0)).toBeCloseTo(24);
    for (const x of r) {
      expect(x.x + x.w).toBeLessThanOrEqual(6.0001);
      expect(x.y + x.h).toBeLessThanOrEqual(4.0001);
    }
  });

  it('finds the hull and draws a closed blob', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(hull).toHaveLength(4);
    expect(blobPath([{ x: 0, y: 0 }], 10)).toMatch(/^M.*Z$/);
  });

  it('places every note in a cluster and on the sphere', () => {
    const nodes = [note('A/x.md'), note('A/y.md'), note('B/z.md')];
    const { pos, clusters } = clusterLayout(nodes, new Map());
    expect(pos.size).toBe(3);
    expect(clusters.map((c) => c.group)).toEqual(['A', 'B']);
    expect(sphereLayout(nodes).size).toBe(3);
  });
});
