import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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

// ── 2.54 "cosy office" look ───────────────────────────────────────────────

const rboxCache = new Map<string, RoundedBoxGeometry>();
/** A rounded box (soft edges catch the light the way real furniture does), cached by size. */
export function rbox(w: number, h: number, d: number, r = 0.02): RoundedBoxGeometry {
  const key = `${w}|${h}|${d}|${r}`;
  let g = rboxCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
    rboxCache.set(key, g);
  }
  return g;
}

/** A city at night through the windows: dark sky, towers, lit windows, a few soft lights. */
export function cityTexture(): THREE.CanvasTexture | null {
  let seed = 11;
  const rand = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return canvasTexture(512, 256, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#0b1230');
    sky.addColorStop(0.6, '#1d2457');
    sky.addColorStop(1, '#3a2f63');
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 26; i++) {
      const w = 18 + rand() * 40;
      const h = 60 + rand() * 170;
      const x = rand() * 512;
      g.fillStyle = `rgba(${8 + rand() * 12},${10 + rand() * 14},${30 + rand() * 30},1)`;
      g.fillRect(x, 256 - h, w, h);
      for (let wy = 256 - h + 8; wy < 250; wy += 11)
        for (let wx = x + 4; wx < x + w - 5; wx += 9)
          if (rand() > 0.68) {
            g.fillStyle = rand() > 0.3 ? 'rgba(255,214,150,0.9)' : 'rgba(150,190,255,0.85)';
            g.fillRect(wx, wy, 4, 5);
          }
    }
    for (let i = 0; i < 14; i++) {
      const x = rand() * 512;
      const y = 120 + rand() * 130;
      const r = 4 + rand() * 12;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rand() > 0.5 ? 'rgba(255,170,90,0.6)' : 'rgba(120,160,255,0.6)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

/** A strip that fades from dark to clear: fake soft shadow where floor meets wall. */
export function edgeShadeTexture(): THREE.CanvasTexture | null {
  return canvasTexture(4, 64, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
  });
}

/** Warm and neutral palette for the cosy office. */
export const COSY = {
  floor: '#4a4743',
  rug: '#34373e',
  wall: '#34363d',
  wallTop: '#5a5e67',
  wood: '#cbbfae',
  darkWood: '#7a5a3f',
  metal: '#2a2e35',
  chair: '#1d2026',
  fabric: '#4c515a',
  sofa: '#3f6b4c',
  pot: '#e6e1d8',
  leaf: '#2f6e3d',
  leafLight: '#4a9157',
  lamp: '#ffc184',
  frame: '#15171b',
} as const;
