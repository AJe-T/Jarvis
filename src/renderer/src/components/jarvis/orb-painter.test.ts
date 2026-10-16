// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ORB_STYLE_IDS } from '@shared/orb-styles';
import type { AssistantState } from '@shared/types';
import { createOrbPainter } from './orb-painter';
import { ORB_STYLE_FACTORIES } from './orb-styles';

/** A 2D context that accepts every call and counts strokes and fills (jsdom has no canvas). */
function fakeContext(): { ctx: CanvasRenderingContext2D; marks: () => number } {
  let marks = 0;
  const gradient = { addColorStop: () => undefined };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'stroke' || key === 'fill' || key === 'fillRect' || key === 'fillText')
        return () => void marks++;
      if (typeof key === 'string' && key.startsWith('create')) return () => gradient;
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, marks: () => marks };
}

const STATES: AssistantState[] = ['IDLE', 'LISTENING', 'THINKING', 'ACTING', 'SPEAKING', 'ERROR'];

describe('orb styles', () => {
  it('has a painter for every style id and no painter without an id', () => {
    expect(Object.keys(ORB_STYLE_FACTORIES).sort()).toEqual([...ORB_STYLE_IDS].sort());
  });

  it.each(ORB_STYLE_IDS)('%s draws something in every state, at every size', (id) => {
    for (const size of [32, 88, 340]) {
      const { ctx, marks } = fakeContext();
      const draw = createOrbPainter(ctx, size, id);
      STATES.forEach((state, i) =>
        draw({ state, level: 0.12, steps: ['done', 'running', 'pending'] }, i * 0.1, false),
      );
      draw({ state: 'IDLE', level: 0, steps: [] }, 1, true);
      expect(marks()).toBeGreaterThan(0);
    }
  });
});
