import type { DisplayGeometry } from './geometry';

export type MouseButton = 'left' | 'right' | 'middle';

/** Mouse/keyboard in physical pixels. Tracks what it holds so the kill switch can release everything. */
export interface InputDriver {
  move(x: number, y: number): Promise<void>;
  position(): Promise<{ x: number; y: number }>;
  click(button: MouseButton, count: 1 | 2 | 3): Promise<void>;
  down(button: MouseButton): Promise<void>;
  up(button: MouseButton): Promise<void>;
  scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>;
  type(text: string): Promise<void>;
  keysDown(keys: string[]): Promise<void>;
  keysUp(keys: string[]): Promise<void>;
  releaseAll(): Promise<void>;
}

export interface ScreenSource {
  display(): DisplayGeometry;
  /** PNG of the primary display at physical resolution, optionally cropped, resized to target size. */
  capture(opts: {
    crop?: { x: number; y: number; width: number; height: number };
    width: number;
    height: number;
  }): Promise<Buffer>;
  /** Cursor position in DIPs as Windows reports it (calibration). */
  cursorDip(): { x: number; y: number };
  /** DIP rectangles of visible Jarvis windows (clicks there are refused). */
  jarvisWindows(): Array<{ x: number; y: number; width: number; height: number }>;
}

/** xdotool-style names Claude uses → nut.js Key enum names. */
const KEY_ALIASES: Record<string, string> = {
  return: 'Enter',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  ctrl: 'LeftControl',
  control: 'LeftControl',
  shift: 'LeftShift',
  alt: 'LeftAlt',
  super: 'LeftSuper',
  win: 'LeftSuper',
  meta: 'LeftSuper',
  cmd: 'LeftSuper',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  page_up: 'PageUp',
  pagedown: 'PageDown',
  page_down: 'PageDown',
  insert: 'Insert',
  minus: 'Minus',
  equal: 'Equal',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',
  semicolon: 'Semicolon',
  menu: 'Menu',
  capslock: 'CapsLock',
  printscreen: 'Print',
  print: 'Print',
};

/** "ctrl+shift+t" → ['LeftControl', 'LeftShift', 'T']; throws on unknown keys. */
export function parseChord(text: string): string[] {
  return text
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const lower = k.toLowerCase();
      if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
      if (/^f([1-9]|1\d|2[0-4])$/i.test(k)) return k.toUpperCase();
      if (/^[a-z]$/i.test(k)) return k.toUpperCase();
      if (/^[0-9]$/.test(k)) return `Num${k}`;
      throw new Error(`Unknown key "${k}"`);
    });
}

/** nut.js-backed driver (Apache-2.0). Loaded lazily so tests and machines without it still start. */
export async function createNutDriver(): Promise<InputDriver> {
  const nut = await import('@nut-tree-fork/nut-js');
  const { mouse, keyboard, Key, Button, Point } = nut;
  mouse.config.autoDelayMs = 20;
  keyboard.config.autoDelayMs = 8;
  const held = new Set<string>();
  const heldButtons = new Set<MouseButton>();
  const toKey = (name: string): number => {
    const k = (Key as unknown as Record<string, number>)[name];
    if (k === undefined) throw new Error(`Unsupported key ${name}`);
    return k;
  };
  const btn = (b: MouseButton): number =>
    ({ left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE })[b];
  return {
    async move(x, y) {
      await mouse.setPosition(new Point(x, y));
    },
    async position() {
      const p = await mouse.getPosition();
      return { x: p.x, y: p.y };
    },
    async click(b, count) {
      if (count === 2) await mouse.doubleClick(btn(b));
      else for (let i = 0; i < count; i++) await mouse.click(btn(b));
    },
    async down(b) {
      await mouse.pressButton(btn(b));
      heldButtons.add(b);
    },
    async up(b) {
      await mouse.releaseButton(btn(b));
      heldButtons.delete(b);
    },
    async scroll(direction, amount) {
      if (direction === 'up') await mouse.scrollUp(amount);
      else if (direction === 'down') await mouse.scrollDown(amount);
      else if (direction === 'left') await mouse.scrollLeft(amount);
      else await mouse.scrollRight(amount);
    },
    async type(text) {
      await keyboard.type(text);
    },
    async keysDown(keys) {
      await keyboard.pressKey(...keys.map(toKey));
      for (const k of keys) held.add(k);
    },
    async keysUp(keys) {
      await keyboard.releaseKey(...[...keys].reverse().map(toKey));
      for (const k of keys) held.delete(k);
    },
    async releaseAll() {
      for (const k of [...held]) await keyboard.releaseKey(toKey(k)).catch(() => undefined);
      held.clear();
      for (const b of [...heldButtons]) await mouse.releaseButton(btn(b)).catch(() => undefined);
      heldButtons.clear();
    },
  };
}

/** Recording fake for tests (Testing.md §6.6 checks that the kill switch releases held keys). */
export function createFakeDriver() {
  const log: string[] = [];
  const held = new Set<string>();
  let pos = { x: 0, y: 0 };
  const d: InputDriver & { log: string[]; held: Set<string> } = {
    log,
    held,
    async move(x, y) {
      pos = { x, y };
      log.push(`move ${x},${y}`);
    },
    async position() {
      return pos;
    },
    async click(b, n) {
      log.push(`click ${b} x${n}`);
    },
    async down(b) {
      held.add(`mouse:${b}`);
      log.push(`down ${b}`);
    },
    async up(b) {
      held.delete(`mouse:${b}`);
      log.push(`up ${b}`);
    },
    async scroll(dir, n) {
      log.push(`scroll ${dir} ${n}`);
    },
    async type(t) {
      log.push(`type ${t}`);
    },
    async keysDown(keys) {
      for (const k of keys) held.add(k);
      log.push(`keydown ${keys.join('+')}`);
    },
    async keysUp(keys) {
      for (const k of keys) held.delete(k);
      log.push(`keyup ${keys.join('+')}`);
    },
    async releaseAll() {
      log.push(`releaseAll ${[...held].join(',')}`);
      held.clear();
    },
  };
  return d;
}

export function createFakeScreen(
  display: DisplayGeometry = {
    bounds: { x: 0, y: 0, width: 1536, height: 864 },
    scaleFactor: 1.25,
  },
): ScreenSource & { captures: number } {
  const s = {
    captures: 0,
    display: () => display,
    async capture() {
      s.captures++;
      return Buffer.from('89504e470d0a1a0a', 'hex'); // PNG signature is enough for tests
    },
    cursorDip: () => ({ x: 0, y: 0 }),
    jarvisWindows: () => [{ x: 1300, y: 700, width: 236, height: 164 }],
  };
  return s;
}
