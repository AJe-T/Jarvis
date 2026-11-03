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
