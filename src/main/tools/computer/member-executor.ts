import { z } from 'zod';
import { checkDesktopAction } from '../../security/desktop-policy';
import { sleep } from '../../lib/util';
import { parseChord, type InputDriver, type MouseButton, type ScreenSource } from './drivers';
import {
  physicalToShot,
  regionToPhysical,
  scaleFor,
  shotGeometry,
  shotToPhysical,
  type ShotGeometry,
} from './geometry';

export type MemberContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
>;

export const COMPUTER_MEMBERS = [
  'screenshot',
  'zoom',
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'left_click_drag',
  'mouse_move',
  'left_mouse_down',
  'left_mouse_up',
  'cursor_position',
  'scroll',
  'type',
  'key',
  'hold_key',
  'wait',
] as const;

const Coord = z.tuple([z.number(), z.number()]);
const Mods = z.string().max(40).optional();
const SCHEMAS: Record<string, z.ZodType> = {
  screenshot: z.object({}).loose(),
  zoom: z.object({ region: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
  left_click: z.object({ coordinate: Coord.optional(), text: Mods }),
  right_click: z.object({ coordinate: Coord.optional(), text: Mods }),
  middle_click: z.object({ coordinate: Coord.optional(), text: Mods }),
  double_click: z.object({ coordinate: Coord.optional(), text: Mods }),
  triple_click: z.object({ coordinate: Coord.optional(), text: Mods }),
  left_click_drag: z.object({ start_coordinate: Coord, coordinate: Coord, text: Mods }),
  mouse_move: z.object({ coordinate: Coord }),
  left_mouse_down: z.object({}).loose(),
  left_mouse_up: z.object({}).loose(),
  cursor_position: z.object({}).loose(),
  scroll: z.object({
    scroll_direction: z.enum(['up', 'down', 'left', 'right']),
    scroll_amount: z.number().int().min(1).max(50),
    coordinate: Coord.optional(),
    text: Mods,
  }),
  type: z.object({ text: z.string().max(5000) }),
  key: z.object({
    text: z.string().min(1).max(60),
    repeat: z.number().int().min(1).max(100).optional(),
  }),
  hold_key: z.object({ text: z.string().min(1).max(60), duration: z.number().min(0).max(300) }),
  wait: z.object({ duration: z.number().min(0).max(300) }),
};

const CLICKS: Record<string, { button: MouseButton; count: 1 | 2 | 3 }> = {
  left_click: { button: 'left', count: 1 },
  right_click: { button: 'right', count: 1 },
  middle_click: { button: 'middle', count: 1 },
  double_click: { button: 'left', count: 2 },
  triple_click: { button: 'left', count: 3 },
};

/** Waits are capped: a single member never blocks the session for long (kill switch stays responsive). */
const MAX_WAIT_S = 30;

export interface MemberDeps {
  input: InputDriver;
  screen: ScreenSource;
  /** Desktop-policy "confirm" verdicts (e.g., alt+F4) ask Sir through the confirmation broker. */
  confirm(summary: string, reason: string): Promise<boolean>;
}

/** API-Guide.md §7: executes one computer_toolset_20260801 member. Throws on failure (caller halts the batch). */
export function createMemberExecutor(d: MemberDeps) {
  let geometry: ShotGeometry = shotGeometry(d.screen.display());

  const toPhysical = (c: readonly [number, number]): { x: number; y: number } =>
    shotToPhysical(geometry, d.screen.display(), c);
  const insideJarvis = (c: [number, number]): boolean => {
    const p = toPhysical(c);
    const sf = d.screen.display().scaleFactor;
    const dip = { x: p.x / sf, y: p.y / sf };
    return d.screen
      .jarvisWindows()
      .some((r) => dip.x >= r.x && dip.y >= r.y && dip.x < r.x + r.width && dip.y < r.y + r.height);
  };

  async function withModifiers(text: string | undefined, fn: () => Promise<void>): Promise<void> {
    const keys = text ? parseChord(text) : [];
    if (keys.length) await d.input.keysDown(keys);
    try {
      await fn();
    } finally {
      if (keys.length) await d.input.keysUp(keys);
    }
  }

  async function screenshot(): Promise<MemberContent> {
    geometry = shotGeometry(d.screen.display());
    const png = await d.screen.capture({
      width: geometry.shot.width,
      height: geometry.shot.height,
    });
    return [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
      },
    ];
  }

  async function run(name: string, raw: unknown, signal: AbortSignal): Promise<MemberContent> {
    const schema = SCHEMAS[name];
    if (!schema) throw new Error(`Member ${name} is not implemented`);
    const input = schema.parse(raw) as Record<string, unknown>;
    const verdict = checkDesktopAction(name, input, { insideJarvis });
    if (verdict.decision === 'block') throw new Error(verdict.reason);
    if (
      verdict.decision === 'confirm' &&
      !(await d.confirm(
        `${name} ${typeof input['text'] === 'string' ? input['text'] : ''}`.trim(),
        verdict.reason,
      ))
    )
      throw new Error('Sir declined this action.');
    if (signal.aborted) throw new Error('Stopped.');

    const click = CLICKS[name];
    if (click) {
      const coordinate = input['coordinate'] as [number, number] | undefined;
      if (coordinate) {
        const p = toPhysical(coordinate);
        await d.input.move(p.x, p.y);
      }
      await withModifiers(input['text'] as string | undefined, () =>
        d.input.click(click.button, click.count),
      );
      return [{ type: 'text', text: 'OK' }];
    }
    switch (name) {
      case 'screenshot':
        return screenshot();
      case 'zoom': {
        const crop = regionToPhysical(
          geometry,
          input['region'] as [number, number, number, number],
        );
        const s = scaleFor(crop.width, crop.height);
        const png = await d.screen.capture({
          crop,
          width: Math.max(1, Math.round(crop.width * s)),
          height: Math.max(1, Math.round(crop.height * s)),
        });
        return [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
          },
        ];
      }
      case 'left_click_drag': {
        const from = toPhysical(input['start_coordinate'] as [number, number]);
        const to = toPhysical(input['coordinate'] as [number, number]);
        await withModifiers(input['text'] as string | undefined, async () => {
          await d.input.move(from.x, from.y);
          await d.input.down('left');
          try {
            await sleep(50);
            await d.input.move(Math.round((from.x + to.x) / 2), Math.round((from.y + to.y) / 2));
            await d.input.move(to.x, to.y);
          } finally {
            await d.input.up('left');
          }
        });
        return [{ type: 'text', text: 'OK' }];
      }
      case 'mouse_move': {
        const p = toPhysical(input['coordinate'] as [number, number]);
        await d.input.move(p.x, p.y);
        return [{ type: 'text', text: 'OK' }];
      }
      case 'left_mouse_down':
        await d.input.down('left');
        return [{ type: 'text', text: 'OK' }];
      case 'left_mouse_up':
        await d.input.up('left');
        return [{ type: 'text', text: 'OK' }];
      case 'cursor_position': {
        const [x, y] = physicalToShot(geometry, d.screen.display(), await d.input.position());
        return [{ type: 'text', text: `X=${x}, Y=${y}` }];
      }
      case 'scroll': {
        const coordinate = input['coordinate'] as [number, number] | undefined;
        if (coordinate) {
          const p = toPhysical(coordinate);
          await d.input.move(p.x, p.y);
        }
        await withModifiers(input['text'] as string | undefined, () =>
          d.input.scroll(input['scroll_direction'] as 'up', input['scroll_amount'] as number),
        );
        return [{ type: 'text', text: 'OK' }];
      }
      case 'type':
        await d.input.type(input['text'] as string);
        return [{ type: 'text', text: 'OK' }];
      case 'key': {
        const keys = parseChord(input['text'] as string);
        for (let i = 0; i < ((input['repeat'] as number | undefined) ?? 1); i++) {
          if (signal.aborted) break;
          await d.input.keysDown(keys);
          await d.input.keysUp(keys);
        }
        return [{ type: 'text', text: 'OK' }];
      }
      case 'hold_key': {
        const keys = parseChord(input['text'] as string);
        await d.input.keysDown(keys);
        try {
          await sleep(Math.min(input['duration'] as number, MAX_WAIT_S) * 1000, signal).catch(
            () => undefined,
          );
        } finally {
          await d.input.keysUp(keys);
        }
        return [{ type: 'text', text: 'OK' }];
      }
      case 'wait':
        await sleep(Math.min(input['duration'] as number, MAX_WAIT_S) * 1000, signal).catch(
          () => undefined,
        );
        return [{ type: 'text', text: 'OK' }];
      default:
        throw new Error(`Member ${name} is not implemented`);
    }
  }

  return { run, screenshot, geometry: () => geometry };
}

export type MemberExecutor = ReturnType<typeof createMemberExecutor>;
