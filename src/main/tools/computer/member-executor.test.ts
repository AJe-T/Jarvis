import { describe, expect, it } from 'vitest';
import { checkDesktopAction } from '../../security/desktop-policy';
import { pruneScreenshots } from '../../agent/desktop-operator';
import type { MessageParam } from '../../llm/types';
import { createFakeDriver, createFakeScreen, parseChord } from './drivers';
import { createMemberExecutor } from './member-executor';

function setup(confirmAnswer = true) {
  const input = createFakeDriver();
  const screen = createFakeScreen(); // 1536×864 DIP @125% → 1920×1080 physical → 1429×804 shot
  const asked: string[] = [];
  const m = createMemberExecutor({
    input,
    screen,
    confirm: async (summary) => {
      asked.push(summary);
      return confirmAnswer;
    },
  });
  return { input, screen, m, asked, signal: new AbortController().signal };
}

describe('computer member executor (computer_toolset_20260801)', () => {
  it('screenshot returns a PNG image block sized to the shot geometry', async () => {
    const { m, signal } = setup();
    const out = await m.run('screenshot', {}, signal);
    expect(out[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    });
    const g = m.geometry();
    expect(Math.max(g.shot.width, g.shot.height)).toBeLessThanOrEqual(1568);
  });

  it('clicks map screenshot coordinates to physical pixels at 125 % scaling', async () => {
    const { m, input, signal } = setup();
    await m.run('screenshot', {}, signal);
    const g = m.geometry();
    await m.run(
      'left_click',
      { coordinate: [Math.round(g.shot.width / 2), Math.round(g.shot.height / 2)] },
      signal,
    );
    const [move, click] = input.log;
    const [x, y] = (move ?? '').replace('move ', '').split(',').map(Number);
    expect(Math.abs((x ?? 0) - 960)).toBeLessThanOrEqual(2);
    expect(Math.abs((y ?? 0) - 540)).toBeLessThanOrEqual(2);
    expect(click).toBe('click left x1');
  });

  it('holds modifiers around a click and releases them', async () => {
    const { m, input, signal } = setup();
    await m.run('right_click', { coordinate: [10, 10], text: 'ctrl+shift' }, signal);
    expect(input.log).toEqual([
      'move 13,13',
      'keydown LeftControl+LeftShift',
      'click right x1',
      'keyup LeftControl+LeftShift',
    ]);
    expect(input.held.size).toBe(0);
  });

  it('double, triple and middle clicks', async () => {
    const { m, input, signal } = setup();
    await m.run('double_click', {}, signal);
    await m.run('triple_click', {}, signal);
    await m.run('middle_click', {}, signal);
    expect(input.log).toEqual(['click left x2', 'click left x3', 'click middle x1']);
  });

  it('drags with the button released afterwards', async () => {
    const { m, input, signal } = setup();
    await m.run('left_click_drag', { start_coordinate: [10, 10], coordinate: [100, 100] }, signal);
    expect(input.log[0]).toBe('move 13,13');
    expect(input.log).toContain('down left');
    expect(input.log.at(-1)).toBe('up left');
  });

  it('types text, presses chords with repeat, scrolls, moves, mouse down/up', async () => {
    const { m, input, signal } = setup();
    await m.run('type', { text: 'Milk, eggs, bread' }, signal);
    await m.run('key', { text: 'ctrl+s', repeat: 2 }, signal);
    await m.run(
      'scroll',
      { scroll_direction: 'down', scroll_amount: 3, coordinate: [5, 5] },
      signal,
    );
    await m.run('mouse_move', { coordinate: [20, 20] }, signal);
    await m.run('left_mouse_down', {}, signal);
    await m.run('left_mouse_up', {}, signal);
    expect(input.log).toEqual([
      'type Milk, eggs, bread',
      'keydown LeftControl+S',
      'keyup LeftControl+S',
      'keydown LeftControl+S',
      'keyup LeftControl+S',
      'move 7,7',
      'scroll down 3',
      'move 27,27',
      'down left',
      'up left',
    ]);
  });

  it('reports the cursor position in screenshot pixels', async () => {
    const { m, input, signal } = setup();
    await input.move(960, 540);
    const out = await m.run('cursor_position', {}, signal);
    expect(out[0]).toMatchObject({ type: 'text' });
    expect((out[0] as { text: string }).text).toMatch(/^X=71\d, Y=40\d$/);
  });

  it('zooms into a region', async () => {
    const { m, screen, signal } = setup();
    const out = await m.run('zoom', { region: [0, 0, 200, 100] }, signal);
    expect(out[0]?.type).toBe('image');
    expect(screen.captures).toBe(1);
  });

  it('caps wait and hold_key durations and honours abort', async () => {
    const { m, input } = setup();
    const c = new AbortController();
    setTimeout(() => c.abort(), 50);
    const start = Date.now();
    await m.run('hold_key', { text: 'shift', duration: 300 }, c.signal);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(input.held.size).toBe(0);
  });

  it('refuses blocked actions (policy) and declined confirmations', async () => {
    const { m, signal, asked } = setup(false);
    await expect(m.run('type', { text: 'my password: hunter22' }, signal)).rejects.toThrow(
      /sensitive data/,
    );
    await expect(m.run('key', { text: 'super+r' }, signal)).rejects.toThrow(/not allowed/);
    await expect(m.run('left_click', { coordinate: [1400, 790] }, signal)).rejects.toThrow(
      /Jarvis's own windows/,
    );
    await expect(m.run('key', { text: 'alt+F4' }, signal)).rejects.toThrow(/declined/);
    expect(asked).toEqual(['key alt+F4']);
    await expect(m.run('fly', {}, signal)).rejects.toThrow(/not implemented/);
    await expect(m.run('left_click', { coordinate: 'nope' }, signal)).rejects.toThrow();
  });

  it('parses key chords', () => {
    expect(parseChord('ctrl+shift+t')).toEqual(['LeftControl', 'LeftShift', 'T']);
    expect(parseChord('Return')).toEqual(['Enter']);
    expect(parseChord('alt+Tab')).toEqual(['LeftAlt', 'Tab']);
    expect(parseChord('F5')).toEqual(['F5']);
    expect(parseChord('1')).toEqual(['Num1']);
    expect(() => parseChord('hyper+q')).toThrow(/Unknown key/);
  });
});

describe('desktop action policy (Security.md §5.3)', () => {
  const ctx = { insideJarvis: (c: [number, number]) => c[0] > 1000 };
  it.each([
    ['screenshot', {}, 'allow'],
    ['scroll', {}, 'allow'],
    ['left_click', { coordinate: [10, 10] }, 'allow'],
    ['left_click', { coordinate: [1200, 10] }, 'block'],
    ['left_click_drag', { start_coordinate: [1200, 10], coordinate: [10, 10] }, 'block'],
    ['type', { text: 'hello' }, 'allow'],
    ['type', { text: 'OTP is 123456' }, 'block'],
    ['key', { text: 'win+r' }, 'block'],
    ['key', { text: 'ctrl + alt + delete' }, 'block'],
    ['hold_key', { text: 'ctrl+shift+esc' }, 'block'],
    ['key', { text: 'alt+f4' }, 'confirm'],
    ['key', { text: 'ctrl+s' }, 'allow'],
    ['key', { text: 42 }, 'allow'],
    ['teleport', {}, 'block'],
  ] as const)('%s %o → %s', (member, input, decision) => {
    expect(checkDesktopAction(member, input as Record<string, unknown>, ctx).decision).toBe(
      decision,
    );
  });
});

describe('screenshot pruning', () => {
  it('keeps only the last 3 screenshots', () => {
    const img = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'x' },
    } as const;
    const msgs: MessageParam[] = [];
    for (let i = 0; i < 5; i++) {
      msgs.push({ role: 'assistant', content: [{ type: 'text', text: `step ${i}` }] });
      msgs.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: [img] }],
      });
    }
    const out = JSON.stringify(pruneScreenshots(msgs));
    expect(out.match(/"type":"image"/g)).toHaveLength(3);
    expect(out.match(/older screenshot removed/g)).toHaveLength(2);
  });
});
