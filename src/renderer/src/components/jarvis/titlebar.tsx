import { useEffect } from 'react';
import { call } from '../../lib/api';

/**
 * No Windows title bar (Design-system.md §5.1): the 48px header rows marked `data-titlebar` drag the
 * window, and Windows draws its minimise / maximise / close buttons over the top-right corner. A
 * header under those buttons gets `data-tb-guard`, which pads its right side (globals.css).
 */
const TITLE_BAR_HEIGHT = 48;
/** Three Windows caption buttons, when the browser can't tell us their size. */
const FALLBACK_INSET = 140;

interface Wco {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: 'geometrychange', cb: () => void): void;
  removeEventListener(type: 'geometrychange', cb: () => void): void;
}
const wco = (): Wco | undefined =>
  (navigator as Navigator & { windowControlsOverlay?: Wco }).windowControlsOverlay;

/** How far from the right edge the caption buttons reach. */
export function controlsInset(rect: { x: number; width: number } | null, viewport: number): number {
  if (!rect || rect.width <= 0) return FALLBACK_INSET;
  return Math.max(0, Math.round(viewport - (rect.x + rect.width)));
}

/** True when a header row sits under the caption buttons. */
export function underControls(
  r: { top: number; right: number; width: number },
  viewport: number,
  inset: number,
): boolean {
  return r.width > 0 && r.top < TITLE_BAR_HEIGHT && r.right > viewport - inset - 1;
}

function guard(): void {
  const o = wco();
  const inset = controlsInset(o?.visible ? o.getTitlebarAreaRect() : null, window.innerWidth);
  const root = document.documentElement;
  if (root.style.getPropertyValue('--tb-inset') !== `${inset}px`)
    root.style.setProperty('--tb-inset', `${inset}px`);
  for (const el of document.querySelectorAll<HTMLElement>('[data-titlebar]')) {
    // Measured without the padding, so adding it never changes the answer.
    const r = el.getBoundingClientRect();
    el.toggleAttribute('data-tb-guard', underControls(r, window.innerWidth, inset));
  }
}

/** A colour token as #rrggbb (tokens may be any CSS colour). */
function hexOf(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const ctx = document.createElement('canvas').getContext('2d');
  if (!value || !ctx) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Keeps the caption buttons clear of the headers and coloured like the theme. */
export function TitleBar(): null {
  useEffect(() => {
    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(guard);
    };
    let last = '';
    const colours = (): void => {
      const color = hexOf('--bg-main', '#070a10');
      const symbolColor = hexOf('--ink-100', '#f0fbff');
      const key = `${color}${symbolColor}`;
      if (key === last) return;
      last = key;
      void call('app:titleBar', { color, symbolColor }).catch(() => undefined);
    };
    schedule();
    colours();
    const layout = new MutationObserver(schedule);
    layout.observe(document.body, { childList: true, subtree: true });
    // Theme changes land as attributes / inline variables on <html>.
    const theme = new MutationObserver(colours);
    theme.observe(document.documentElement, { attributes: true });
    window.addEventListener('resize', schedule);
    wco()?.addEventListener('geometrychange', schedule);
    return () => {
      cancelAnimationFrame(frame);
      layout.disconnect();
      theme.disconnect();
      window.removeEventListener('resize', schedule);
      wco()?.removeEventListener('geometrychange', schedule);
    };
  }, []);
  return null;
}
