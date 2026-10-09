import { describe, expect, it } from 'vitest';
import type { StagePanel } from '@shared/stage';
import { createStageTools } from './stage-tools';
import type { ToolContext } from '../tools/types';

const ctx = {} as ToolContext;

function setup(): {
  shown: Array<StagePanel | null>;
  show: ReturnType<typeof createStageTools>[0];
  hide: ReturnType<typeof createStageTools>[1];
} {
  const shown: Array<StagePanel | null> = [];
  const [show, hide] = createStageTools((p) => shown.push(p));
  if (!show || !hide) throw new Error('tools missing');
  return { shown, show, hide };
}

describe('stage panel tools', () => {
  it('shows a pomodoro with defaults filled in, and hides it', async () => {
    const { shown, show, hide } = setup();
    const input = show.input.parse({ panel: { kind: 'pomodoro' } });
    expect(show.tier).toBe('SAFE');
    expect(show.summarize(input)).toBe('Show pomodoro on screen');
    await show.run(input, ctx);
    await hide.run(hide.input.parse({}), ctx);
    expect(shown).toEqual([{ kind: 'pomodoro', minutes: 25, breakMinutes: 5 }, null]);
  });

  it('carries Jarvis content for generic panels and names it in the summary', () => {
    const { show } = setup();
    const input = show.input.parse({
      panel: { kind: 'list', title: 'Pending tasks', items: [{ text: 'Pay rent', done: false }] },
    });
    expect(show.summarize(input)).toBe('Show "Pending tasks" on screen');
  });

  it('rejects unknown kinds, empty lists and oversized notes', () => {
    const { show } = setup();
    for (const panel of [
      { kind: 'webview', url: 'https://x' },
      { kind: 'list', title: 'x', items: [] },
      { kind: 'note', title: 'x', markdown: 'y'.repeat(8001) },
      { kind: 'pomodoro', minutes: 0 },
    ])
      expect(show.input.safeParse({ panel }).success).toBe(false);
  });
});
