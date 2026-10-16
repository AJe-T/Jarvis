import { describe, expect, it } from 'vitest';
import {
  nextOrder,
  panelWidth,
  panelsToClose,
  RAIL_STUB,
  STAGE_MIN,
  type PanelId,
} from './panel-fit';

const at = (win: number) => (id: PanelId) => panelWidth(id, win, null);

describe('panel fit', () => {
  it('keeps everything when the window has room', () => {
    expect(panelsToClose(['rail', 'history', 'log'], 1920, STAGE_MIN, at(1920))).toEqual([]);
  });

  it('closes the oldest panels first and keeps any that fit again', () => {
    // 1366 px: rail 256 + history 256 + log 400 + activity 320 leaves 134 px for the orb.
    // Collapsing the rail alone is not enough; once history closes, the rail fits again.
    expect(
      panelsToClose(['rail', 'history', 'log', 'activity'], 1366 - RAIL_STUB, STAGE_MIN, at(1366)),
    ).toEqual(['history']);
    // Below lg the log and activity are sheets on the same edge: only the newer one stays.
    expect(
      panelsToClose(['rail', 'log', 'activity'], 1100 - RAIL_STUB, STAGE_MIN, at(1100)),
    ).toEqual(['log']);
  });

  it('closes only the panel already open when a single new one does not fit', () => {
    expect(panelsToClose(['log', 'activity'], 1000, STAGE_MIN, at(1000))).toEqual(['log']);
    expect(panelsToClose(['activity'], 500, STAGE_MIN, at(500))).toEqual([]);
  });

  it('tracks opening order', () => {
    const open = { rail: false, history: true, activity: true, log: false };
    expect(nextOrder(['activity'], open)).toEqual(['activity', 'history']);
    expect(nextOrder(['activity', 'history'], { ...open, activity: false })).toEqual(['history']);
  });
});
