import { contentGuard } from './guards';

export type DesktopVerdict =
  | { decision: 'allow' }
  | { decision: 'confirm'; reason: string }
  | { decision: 'block'; reason: string };

/** Chords that open system-level escape hatches; native tools exist for the legitimate uses. */
const BLOCKED_CHORDS = [
  /^(win|super|meta|cmd)\+r$/i, // Run dialog
  /^(win|super|meta|cmd)\+x$/i, // power-user menu
  /^ctrl\+alt\+(del|delete)$/i,
  /^ctrl\+shift\+(esc|escape)$/i, // Task Manager
  /^(win|super|meta|cmd)\+l$/i, // lock (use lock_screen)
];
const CONFIRM_CHORDS = [/^alt\+f4$/i, /^ctrl\+w$/i, /^ctrl\+shift\+(del|delete)$/i];

const textOf = (input: Record<string, unknown>): string =>
  typeof input['text'] === 'string' ? input['text'] : '';

const normalizeChord = (t: string): string =>
  t
    .toLowerCase()
    .split('+')
    .map((k) => k.trim())
    .join('+');

/**
 * Security.md §5.3 desktop action policy for computer-use members. `insideJarvis` reports whether a
 * target point lies on one of Jarvis's own windows (its confirmation buttons must never be clicked by the AI).
 */
export function checkDesktopAction(
  member: string,
  input: Record<string, unknown>,
  ctx: { insideJarvis(coordinate: [number, number]): boolean },
): DesktopVerdict {
  const coord = Array.isArray(input['coordinate'])
    ? (input['coordinate'] as [number, number])
    : null;
  const start = Array.isArray(input['start_coordinate'])
    ? (input['start_coordinate'] as [number, number])
    : null;
  switch (member) {
    case 'screenshot':
    case 'zoom':
    case 'cursor_position':
    case 'mouse_move':
    case 'scroll':
    case 'wait':
    case 'left_mouse_up':
      return { decision: 'allow' };
    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click':
    case 'triple_click':
    case 'left_mouse_down':
    case 'left_click_drag':
      for (const c of [coord, start]) {
        if (c && ctx.insideJarvis(c))
          return { decision: 'block', reason: "Clicking Jarvis's own windows is not allowed." };
      }
      return { decision: 'allow' };
    case 'type': {
      const g = contentGuard(textOf(input));
      return g.ok
        ? { decision: 'allow' }
        : { decision: 'block', reason: `Typing blocked: ${g.reason}` };
    }
    case 'key':
    case 'hold_key': {
      const chord = normalizeChord(textOf(input));
      if (BLOCKED_CHORDS.some((r) => r.test(chord)))
        return {
          decision: 'block',
          reason: `The ${chord} shortcut is not allowed in computer-control mode.`,
        };
      if (CONFIRM_CHORDS.some((r) => r.test(chord)))
        return { decision: 'confirm', reason: `${chord} closes a window or tab.` };
      return { decision: 'allow' };
    }
    default:
      return { decision: 'block', reason: `Unknown computer action "${member}".` };
  }
}
