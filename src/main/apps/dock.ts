import type { BrowserWindow, Rectangle, WebContentsView } from 'electron';
import type { DockedKind } from '@shared/jarvis-apps';

/**
 * ADR-040: Jarvis Browser, Terminal and Camera open beside the orb. Each stays its own isolated page
 * (own webContents, own preload, own session where it has one), placed by main inside the main
 * window over the area of Core's panel the renderer reports. The renderer never gets their APIs.
 *
 * Native views draw above the app's page, so they are hidden while a confirmation is open (main
 * knows that itself) and while the renderer shows a dialog over the stage.
 */
export interface Dockable {
  /** The app's views, top to bottom: a fixed height, or null for the rest. Created on first use. */
  views(): Array<{ view: WebContentsView; height: number | null }>;
  /** The views left the main window (panel closed, or another docked app opened). */
  released?(): void;
}

export interface DockBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** CSS pixels from the renderer → window pixels; stacked top to bottom. */
export function stack(
  bounds: DockBounds,
  zoom: number,
  heights: Array<number | null>,
): Rectangle[] {
  const x = Math.round(bounds.x * zoom);
  const width = Math.max(0, Math.round(bounds.width * zoom));
  const total = Math.max(0, Math.round(bounds.height * zoom));
  const fixed = heights.reduce<number>((a, h) => a + (h ?? 0), 0);
  let y = Math.round(bounds.y * zoom);
  return heights.map((h) => {
    const height = h === null ? Math.max(0, total - fixed) : Math.min(h, total);
    const r = { x, y, width, height };
    y += height;
    return r;
  });
}

export function createDock(deps: {
  main(): BrowserWindow | null;
  apps: Record<DockedKind, Dockable>;
}) {
  let current: { id: DockedKind; bounds: DockBounds | null } | null = null;
  let placed: WebContentsView[] = [];
  /** Open confirmation requests (by id, so a lost "resolved" can't leave the views hidden twice). */
  const confirmations = new Set<string>();

  const alive = (v: WebContentsView): boolean => !v.webContents.isDestroyed();

  function detach(): void {
    const win = deps.main();
    for (const v of placed)
      if (win && !win.isDestroyed() && alive(v)) win.contentView.removeChildView(v);
    placed = [];
  }

  function layout(): void {
    const win = deps.main();
    if (!current || !win || win.isDestroyed()) return;
    const views = deps.apps[current.id].views().filter((v) => alive(v.view));
    const visible = !!current.bounds && confirmations.size === 0;
    const rects = current.bounds
      ? stack(
          current.bounds,
          win.webContents.getZoomFactor(),
          views.map((v) => v.height),
        )
      : [];
    views.forEach(({ view }, i) => {
      if (!placed.includes(view)) {
        win.contentView.addChildView(view);
        placed.push(view);
      }
      const r = rects[i];
      if (r) view.setBounds(r);
      view.setVisible(visible && !!r && r.width > 0 && r.height > 0);
    });
  }

  return {
    /** The renderer's panel for `id` is at `bounds` (CSS px), hidden under a dialog (null bounds), or gone. */
    place(id: DockedKind, bounds: DockBounds | null, open: boolean): void {
      if (!open) {
        if (current?.id !== id) return;
        detach();
        current = null;
        deps.apps[id].released?.();
        return;
      }
      if (current && current.id !== id) {
        const old = current.id;
        detach();
        deps.apps[old].released?.();
      }
      current = { id, bounds };
      layout();
    },
    /** A confirmation opened or closed: nothing may cover it. */
    confirmation(requestId: string, open: boolean): void {
      if (open) confirmations.add(requestId);
      else confirmations.delete(requestId);
      layout();
    },
    current: (): DockedKind | null => current?.id ?? null,
    /** An app closed its views by itself (e.g. "close the browser"). */
    closed(id: DockedKind): void {
      if (current?.id !== id) return;
      detach();
      current = null;
    },
  };
}

export type Dock = ReturnType<typeof createDock>;
