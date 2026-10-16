/**
 * Core's side panels share one row with the orb stage. When Sir opens one more than the window can
 * hold, Jarvis closes the panels opened longest ago (the sidebar collapses first) instead of
 * squeezing the stage until the layout breaks.
 */

export type PanelId = 'rail' | 'history' | 'activity' | 'log';

const LG = 1200;
const XL = 1600;
/** The collapsed sidebar strip stays on screen. */
export const RAIL_STUB = 44;
/** The orb keeps at least this much room; an app on the stage needs more. */
export const STAGE_MIN = 360;
export const STAGE_MIN_WITH_APP = 760;

/**
 * Width an open panel takes at this window width. The sidebar counts only what it adds to its
 * collapsed strip. Below lg the log and activity are sheets that would overlap each other.
 */
export function panelWidth(id: PanelId, win: number, logWidth: number | null): number {
  switch (id) {
    case 'rail':
      return (win >= LG ? 256 : 56) - RAIL_STUB;
    case 'history':
      return 256;
    case 'activity':
      return win >= XL ? 360 : 320;
    case 'log':
      return win >= LG ? (logWidth ?? (win >= XL ? 460 : 400)) : 448;
  }
}

/**
 * Panels to close, oldest first, until the stage keeps `stageMin` px of `room`.
 * `open` is in opening order (oldest first); the newest one is never closed.
 */
export function panelsToClose(
  open: readonly PanelId[],
  room: number,
  stageMin: number,
  width: (id: PanelId) => number,
): PanelId[] {
  let used = open.reduce((sum, id) => sum + width(id), 0);
  const closing: PanelId[] = [];
  for (const id of open.slice(0, -1)) {
    if (room - used >= stageMin) break;
    closing.push(id);
    used -= width(id);
  }
  // Closing a later panel may have made room for an earlier one again (usually the sidebar).
  return closing.filter((id) => {
    if (room - used - width(id) < stageMin) return true;
    used += width(id);
    return false;
  });
}

/** Keeps the opening order: closed panels drop out, newly opened ones go to the end. */
export function nextOrder(
  order: readonly PanelId[],
  isOpen: Readonly<Record<PanelId, boolean>>,
): PanelId[] {
  const kept = order.filter((id) => isOpen[id]);
  const added = (Object.keys(isOpen) as PanelId[]).filter((id) => isOpen[id] && !kept.includes(id));
  return [...kept, ...added];
}
