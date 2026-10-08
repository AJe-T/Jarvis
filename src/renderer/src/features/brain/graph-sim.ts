/**
 * A small force-directed layout for the Brain view (no dependency): links pull, every dot pushes the
 * others away, and a soft brain-shaped boundary (two hemispheres) keeps the network together.
 */

export interface SimNode {
  id: string;
  title: string;
  group: string;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  /** Held by the mouse: the simulation leaves it where it is. */
  fixed?: boolean;
}

export interface SimLink {
  source: SimNode;
  target: SimNode;
  kind: 'link' | 'folder';
}

/** Stable small hash so a folder always lands in the same hemisphere and gets the same colour. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSim(
  nodes: Array<{ id: string; title: string; group: string; size: number }>,
  links: Array<{ source: string; target: string; kind: 'link' | 'folder' }>,
  radius = 420,
): { nodes: SimNode[]; links: SimLink[]; tick(): number; reheat(a?: number): void } {
  const byId = new Map<string, SimNode>();
  const simNodes = nodes.map((n, i) => {
    // Seed on a golden-angle spiral inside the hemisphere for the node's group.
    const side = hash(n.group) % 2 === 0 ? -1 : 1;
    const a = i * 2.399963;
    const r = Math.sqrt(i / Math.max(nodes.length, 1)) * radius * 0.8;
    const s: SimNode = {
      ...n,
      x: side * radius * 0.35 + Math.cos(a) * r * 0.55,
      y: Math.sin(a) * r * 0.6,
      vx: 0,
      vy: 0,
      degree: 0,
    };
    byId.set(n.id, s);
    return s;
  });
  const simLinks: SimLink[] = [];
  for (const l of links) {
    const source = byId.get(l.source);
    const target = byId.get(l.target);
    if (!source || !target) continue;
    source.degree++;
    target.degree++;
    simLinks.push({ source, target, kind: l.kind });
  }

  let alpha = 1;
  const ALPHA_MIN = 0.004;
  const DECAY = 0.0228; // ~300 ticks to settle
  const rx = radius * 1.25;
  const ry = radius * 0.9;

  function tick(): number {
    if (alpha < ALPHA_MIN) return alpha;
    const n = simNodes.length;
    // Repulsion (all pairs; fine for the ~1–2k notes a personal vault has, and it stops when settled).
    const strength = (n > 800 ? 900 : 1600) * alpha;
    for (let i = 0; i < n; i++) {
      const a = simNodes[i] as SimNode;
      for (let j = i + 1; j < n; j++) {
        const b = simNodes[j] as SimNode;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 90_000) continue; // beyond 300px the push is negligible
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const f = strength / d2;
        const fx = dx * f * 0.05;
        const fy = dy * f * 0.05;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // Springs: wiki links are short and strong, folder links longer and looser.
    for (const l of simLinks) {
      const dx = l.target.x - l.source.x;
      const dy = l.target.y - l.source.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = l.kind === 'link' ? 50 : 70;
      const k = (l.kind === 'link' ? 0.08 : 0.04) * alpha;
      const f = ((d - rest) / d) * k;
      const w = l.source.degree / (l.source.degree + l.target.degree);
      l.target.vx -= dx * f * w;
      l.target.vy -= dy * f * w;
      l.source.vx += dx * f * (1 - w);
      l.source.vy += dy * f * (1 - w);
    }
    // Brain outline: a soft ellipse wall, and a slight pull of each group toward its hemisphere.
    for (const p of simNodes) {
      const e = (p.x / rx) ** 2 + (p.y / ry) ** 2;
      if (e > 1) {
        const pull = (1 - 1 / Math.sqrt(e)) * 0.3;
        p.vx -= p.x * pull;
        p.vy -= p.y * pull;
      }
      const side = hash(p.group) % 2 === 0 ? -1 : 1;
      p.vx += (side * radius * 0.4 - p.x) * 0.002 * alpha;
      p.vy += -p.y * 0.003 * alpha;
    }
    for (const p of simNodes) {
      if (p.fixed) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx *= 0.6;
      p.vy *= 0.6;
      p.x += p.vx;
      p.y += p.vy;
    }
    alpha *= 1 - DECAY;
    return alpha;
  }

  return {
    nodes: simNodes,
    links: simLinks,
    tick,
    reheat: (a = 0.3) => {
      alpha = Math.max(alpha, a);
    },
  };
}
