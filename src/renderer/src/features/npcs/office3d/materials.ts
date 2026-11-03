import * as THREE from 'three';

/**
 * Shared geometry, materials and generated textures for the 3D office (2.51). Everything is built in
 * code: no model files, no downloads, no third-party art. Shared so 60 NPCs don't mean 60 copies.
 */

export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 24),
  capsule: new THREE.CapsuleGeometry(0.16, 0.34, 6, 12),
  arm: new THREE.CapsuleGeometry(0.045, 0.32, 4, 8),
  leg: new THREE.CapsuleGeometry(0.06, 0.36, 4, 8),
  head: new THREE.BoxGeometry(0.3, 0.27, 0.28),
  visor: new THREE.BoxGeometry(0.31, 0.075, 0.2),
  plane: new THREE.PlaneGeometry(1, 1),
  ring: new THREE.RingGeometry(0.42, 0.5, 40),
  ico: new THREE.IcosahedronGeometry(1, 1),
};

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** A standard material per colour and look, made once. */
export function mat(
  color: string,
  opts: {
    emissive?: string;
    emissiveIntensity?: number;
    roughness?: number;
    metalness?: number;
  } = {},
): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, opts]);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.65,
      metalness: opts.metalness ?? 0.1,
      ...(opts.emissive
        ? {
            emissive: new THREE.Color(opts.emissive),
            emissiveIntensity: opts.emissiveIntensity ?? 1,
          }
        : {}),
    });
    cache.set(key, m);
  }
  return m;
}

export const GLASS = new THREE.MeshPhysicalMaterial({
  color: '#9fd8ff',
  transparent: true,
  opacity: 0.14,
  roughness: 0.05,
  metalness: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The neon floor grid, tiled once per metre. */
export function gridTexture(line: string): THREE.CanvasTexture | null {
  const t = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = line;
    g.globalAlpha = 0.35;
    g.lineWidth = 2;
    g.strokeRect(0, 0, 128, 128);
    g.globalAlpha = 0.12;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(64, 0);
    g.lineTo(64, 128);
    g.moveTo(0, 64);
    g.lineTo(128, 64);
    g.stroke();
  });
  if (t) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

/** Lines of "code" for a working monitor; scrolled by moving the texture. White, tinted per desk. */
export function codeTexture(seed: number): THREE.CanvasTexture | null {
  let r = seed * 9301 + 49297;
  const rand = (): number => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const t = canvasTexture(128, 256, (g) => {
    g.fillStyle = '#050a12';
    g.fillRect(0, 0, 128, 256);
    for (let y = 6; y < 256; y += 9) {
      let x = 6 + Math.floor(rand() * 4) * 8;
      const words = 1 + Math.floor(rand() * 4);
      for (let w = 0; w < words && x < 120; w++) {
        const len = 8 + Math.floor(rand() * 26);
        g.fillStyle = rand() > 0.75 ? '#ffffff' : 'rgba(255,255,255,0.55)';
        g.fillRect(x, y, Math.min(len, 122 - x), 3);
        x += len + 5;
      }
    }
  });
  if (t) {
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 0.5);
  }
  return t;
}

/** Reads a colour token from the app's theme (so the office follows the accent Sir picked). */
export function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // THREE.Color reads hex, rgb() and hsl(); anything else falls back.
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v) || /^(rgb|hsl)\(/i.test(v) ? v : fallback;
}

// ── 2.52 "Holo-Ops" look ──────────────────────────────────────────────────

/**
 * Hexagon tiles for the deck: dark fill, thin bright seams (used as the emissive map, so only the
 * seams glow and bloom), a few brighter tiles for life. Tiles once per `scale` metres.
 */
export function hexTexture(): THREE.CanvasTexture | null {
  const W = 256;
  const r = 32;
  const h = Math.sqrt(3) * r;
  const t = canvasTexture(W, Math.round(h * 4), (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, h * 4);
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let row = -1; row < 6; row++)
      for (let col = -1; col < 6; col++) {
        const cx = col * r * 1.5;
        const cy = row * h + (col % 2 === 0 ? 0 : h / 2);
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k;
          const x = cx + Math.cos(a) * (r - 2);
          const y = cy + Math.sin(a) * (r - 2);
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        const lit = rand();
        if (lit > 0.93) {
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fill();
        }
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 3;
        g.stroke();
      }
  });
  if (t) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

/** A soft round glow (white centre fading out), for sprites, thruster light and fake contact shadows. */
export function glowTexture(): THREE.CanvasTexture | null {
  return canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

let glow: THREE.CanvasTexture | null | undefined;
/** One shared glow texture. */
export function sharedGlow(): THREE.CanvasTexture | null {
  glow ??= glowTexture();
  return glow;
}

/** Ring desks and pills: a lathe of a rounded rectangle (rounded edges catch the light). */
export function ringDeskGeometry(
  inner: number,
  outer: number,
  height: number,
): THREE.LatheGeometry {
  const r = Math.min(0.04, height / 2);
  const pts: THREE.Vector2[] = [];
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (Math.PI / 2) * (k / 4);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  corner(outer - r, r, -Math.PI / 2);
  corner(outer - r, height - r, 0);
  corner(inner + r, height - r, Math.PI / 2);
  corner(inner + r, r, Math.PI);
  pts.push(pts[0]!.clone());
  return new THREE.LatheGeometry(pts, 64);
}

export const GEO2 = {
  ringDesk: ringDeskGeometry(0.5, 0.98, 0.07),
  torus: new THREE.TorusGeometry(1, 0.03, 12, 96),
  thinTorus: new THREE.TorusGeometry(1, 0.012, 8, 96),
  octa: new THREE.OctahedronGeometry(1, 0),
  /** A curved holo-screen: a slice of an open cylinder. */
  screen: new THREE.CylinderGeometry(0.62, 0.62, 0.36, 24, 1, true, -0.42, 0.84),
  dome: new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
  hexagon: new THREE.CylinderGeometry(1, 1, 1, 6),
  pill: new THREE.CapsuleGeometry(0.17, 0.22, 8, 20),
  headSphere: new THREE.SphereGeometry(0.21, 32, 20),
  // A slice of a slightly larger sphere, centred on +z (three's phi starts at -x): the glass visor.
  facePlate: new THREE.SphereGeometry(0.214, 32, 16, Math.PI / 2 - 0.95, 1.9, 0.75, 1.1),
  eye: new THREE.CapsuleGeometry(0.022, 0.035, 4, 8),
  hand: new THREE.SphereGeometry(0.055, 16, 10),
};

/** A new additive "light" material: glows under bloom. The caller owns it (animate it, dispose it). */
export function newGlowMat(color: string, opacity = 0.9): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const glowCache = new Map<string, THREE.MeshBasicMaterial>();
/** A shared, never-changed glow material per colour and strength (safe to use in render). */
export function glowMat(color: string, opacity = 0.9): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity.toFixed(2)}`;
  let m = glowCache.get(key);
  if (!m) {
    m = newGlowMat(color, opacity);
    glowCache.set(key, m);
  }
  return m;
}
