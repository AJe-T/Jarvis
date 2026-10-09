import { useCallback, useRef } from 'react';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Wheel to zoom at the pointer, drag the background to pan, for the SVG Brain views. The transform
 * is written straight to the <g>, so panning a big graph never re-renders React.
 */
export function usePanZoom(bounds: () => Box | null, maxZoom = 4) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const view = useRef({ k: 1, tx: 0, ty: 0 });

  const apply = (): void => {
    const { k, tx, ty } = view.current;
    gRef.current?.setAttribute(
      'transform',
      `translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${k.toFixed(4)})`,
    );
  };

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const b = bounds();
    if (!svg || !b) return;
    const w = svg.clientWidth;
    const h = svg.clientHeight;
    const k = Math.min(
      (w * 0.9) / Math.max(1, b.x1 - b.x0),
      (h * 0.9) / Math.max(1, b.y1 - b.y0),
      maxZoom,
    );
    view.current = { k, tx: w / 2 - ((b.x0 + b.x1) / 2) * k, ty: h / 2 - ((b.y0 + b.y1) / 2) * k };
    apply();
  }, [bounds, maxZoom]);

  const center = useCallback((x: number, y: number, minZoom = 1.4) => {
    const svg = svgRef.current;
    if (!svg) return;
    const k = Math.max(view.current.k, minZoom);
    view.current = { k, tx: svg.clientWidth / 2 - x * k, ty: svg.clientHeight / 2 - y * k };
    apply();
  }, []);

  const onWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const v = view.current;
    const k = Math.min(maxZoom * 2, Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.0015)));
    view.current = { k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k };
    apply();
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    let x = e.clientX;
    let y = e.clientY;
    const move = (ev: PointerEvent): void => {
      view.current.tx += ev.clientX - x;
      view.current.ty += ev.clientY - y;
      x = ev.clientX;
      y = ev.clientY;
      apply();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // Window listeners, not pointer capture: a click on a dot must still reach the dot.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return { svgRef, gRef, fit, center, handlers: { onWheel, onPointerDown } };
}
