/** Mini orb geometry (pure, so it is tested without Electron). */
interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Window just big enough for the orb, so nothing around it stops clicks reaching other apps. */
export const ORB_SIZE = 88;
/** Tucked away: a slim glowing handle on the screen edge (Xbox Game Bar style). */
export const TAB = { width: 14, height: 88 };
export const CAPTION_WIDTH = 240;
const MARGIN = 12;

export type Side = 'left' | 'right';
export interface Dock {
  /** A point on the display the orb lives on (x), and the orb's top edge (y). */
  px: number;
  y: number;
  side: Side;
  tucked: boolean;
}

/** Where the window goes for a dock on a display's work area (pure; tested). */
export function miniBounds(dock: Dock, area: Rectangle, caption: boolean): Rectangle {
  const clampY = (y: number, h: number): number =>
    Math.round(Math.min(Math.max(y, area.y), area.y + area.height - h));
  if (dock.tucked) {
    const x = dock.side === 'left' ? area.x : area.x + area.width - TAB.width;
    return { x, y: clampY(dock.y + (ORB_SIZE - TAB.height) / 2, TAB.height), ...TAB };
  }
  const width = ORB_SIZE + (caption ? CAPTION_WIDTH : 0);
  const x = dock.side === 'left' ? area.x + MARGIN : area.x + area.width - MARGIN - width;
  return { x, y: clampY(dock.y, ORB_SIZE), width, height: ORB_SIZE };
}

/** After a drag: the nearer side edge wins; pushed past the edge means "tuck it away". */
export function dropDock(win: Rectangle, area: Rectangle, wasTucked: boolean): Dock {
  const cx = win.x + win.width / 2;
  const side: Side = cx < area.x + area.width / 2 ? 'left' : 'right';
  const pastEdge =
    win.x < area.x - win.width / 3 || win.x + win.width > area.x + area.width + win.width / 3;
  return { px: cx, y: win.y, side, tucked: pastEdge || (wasTucked && win.width <= TAB.width) };
}
