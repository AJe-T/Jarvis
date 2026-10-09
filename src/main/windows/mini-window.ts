import { join } from 'node:path';
import { BrowserWindow, Menu, app, screen, type Rectangle } from 'electron';
import { HARDENED_WEB_PREFERENCES, hardenWindow } from './hardening';
import { ORB_SIZE, dropDock, miniBounds, type Dock } from './mini-dock';

export type { Dock } from './mini-dock';
const DRAG_MS = 16;
const CLICK_SLOP = 4;
const MAX_DRAG_MS = 60_000;

/**
 * Design-system.md §4.3 mini mode: a small always-on-top orb Sir can drag anywhere along the screen
 * edges, tuck into the edge as a handle, or hide; the spot is remembered.
 */
export function createMiniOrb(deps: {
  load(): Dock | null;
  save(dock: Dock): void;
  open(): void;
  hide(): void;
}) {
  let win: BrowserWindow | null = null;
  let dock: Dock = deps.load() ?? defaultDock();
  let caption = false;
  let timedOut = false;
  let drag: {
    started: number;
    timer: ReturnType<typeof setInterval>;
    dx: number;
    dy: number;
    x0: number;
    y0: number;
    moved: boolean;
  } | null = null;

  function defaultDock(): Dock {
    const a = screen.getPrimaryDisplay().workArea;
    return {
      px: a.x + a.width - 1,
      y: a.y + a.height - ORB_SIZE - 24,
      side: 'right',
      tucked: false,
    };
  }
  const areaOf = (d: Dock): Rectangle =>
    screen.getDisplayNearestPoint({ x: Math.round(d.px), y: Math.round(d.y) }).workArea;

  function layout(): void {
    if (!win || win.isDestroyed()) return;
    const want = miniBounds(dock, areaOf(dock), caption && !dock.tucked);
    win.setBounds(want);
    // Windows keeps frameless windows at least ~30px wide: on the left edge, push the extra off-screen.
    const got = win.getBounds();
    if (dock.tucked && dock.side === 'left' && got.width > want.width)
      win.setPosition(want.x - (got.width - want.width), got.y);
    win.webContents.send('mini:layout', { side: dock.side, tucked: dock.tucked });
  }

  function create(): BrowserWindow {
    // A saved spot on a monitor that is gone falls back to the primary screen.
    const on = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        dock.px >= a.x &&
        dock.px < a.x + a.width &&
        dock.y >= a.y - ORB_SIZE &&
        dock.y < a.y + a.height
      );
    });
    if (!on) dock = defaultDock();
    const w = new BrowserWindow({
      ...miniBounds(dock, areaOf(dock), false),
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      title: 'Jarvis (mini)',
      webPreferences: {
        ...HARDENED_WEB_PREFERENCES,
        preload: join(__dirname, '../preload/index.js'),
      },
    });
    hardenWindow(w);
    w.setAlwaysOnTop(true, 'floating');
    w.webContents.on('did-finish-load', layout);
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) void w.loadURL(`${devUrl}#mini`);
    else void w.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' });
    w.on('closed', () => {
      if (drag) clearInterval(drag.timer);
      drag = null;
      win = null;
    });
    win = w;
    return w;
  }

  /** Stops following the cursor; a real move snaps to an edge and is saved. */
  function finishDrag(): boolean {
    if (!drag) return false;
    clearInterval(drag.timer);
    const moved = drag.moved;
    drag = null;
    if (moved && win) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      setDock(dropDock(win.getBounds(), area, dock.tucked));
    }
    return moved;
  }

  function setDock(next: Dock): void {
    dock = next;
    deps.save(dock);
    layout();
  }

  return {
    window: (): BrowserWindow | null => win,
    create,
    dragStart(): void {
      if (!win || drag) return;
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      drag = {
        dx: p.x - b.x,
        dy: p.y - b.y,
        x0: p.x,
        y0: p.y,
        moved: false,
        started: Date.now(),
        timer: setInterval(() => {
          if (!win || !drag) return;
          // A drag whose pointerup never arrived must not glue the orb to the cursor.
          if (Date.now() - drag.started > MAX_DRAG_MS) {
            // The next dragEnd must not read as a click and open Jarvis.
            finishDrag();
            timedOut = true;
            return;
          }
          const c = screen.getCursorScreenPoint();
          if (Math.abs(c.x - drag.x0) + Math.abs(c.y - drag.y0) > CLICK_SLOP) drag.moved = true;
          if (drag.moved) win.setPosition(c.x - drag.dx, c.y - drag.dy);
        }, DRAG_MS),
      };
    },
    dragEnd(): { moved: boolean } {
      if (drag) return { moved: finishDrag() };
      const moved = timedOut;
      timedOut = false;
      return { moved };
    },
    tuck(tucked: boolean): void {
      setDock({ ...dock, tucked });
    },
    caption(open: boolean): void {
      if (caption === open) return;
      caption = open;
      layout();
    },
    /** Right-click on the orb: a native menu (it can draw outside the tiny window). */
    menu(): void {
      if (!win) return;
      Menu.buildFromTemplate([
        { label: 'Open Jarvis', click: deps.open },
        { type: 'separator' },
        dock.tucked
          ? { label: 'Bring the orb out', click: () => setDock({ ...dock, tucked: false }) }
          : { label: 'Tuck into the edge', click: () => setDock({ ...dock, tucked: true }) },
        {
          label: `Move to the ${dock.side === 'left' ? 'right' : 'left'} edge`,
          click: () => {
            const a = areaOf(dock);
            setDock({
              ...dock,
              side: dock.side === 'left' ? 'right' : 'left',
              px: dock.side === 'left' ? a.x + a.width - 1 : a.x,
            });
          },
        },
        { label: 'Hide the orb (tray icon brings it back)', click: deps.hide },
      ]).popup({ window: win });
    },
  };
}

export type MiniOrb = ReturnType<typeof createMiniOrb>;
