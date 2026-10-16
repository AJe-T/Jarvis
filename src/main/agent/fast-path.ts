import type { Logger } from '../logging/logger';
import { evaluate, formatResult, mathQuestion } from '@shared/calc';
import { normalizePhrase } from '../voice/quick-commands';
import type { DirectAction } from './orchestrator';

/**
 * ADR-030 fast path: a short, plain PC command ("open spotify", "volume 30", "next song") runs its
 * one tool straight away, typed or spoken, with no Claude call: no tokens and no waiting. Rules catch
 * commands with a value; Laya (when installed) catches loosely worded ones that need none ("this
 * song is boring, skip it"). Anything unclear goes to Claude as before. Only SAFE, undoable tools,
 * always through the normal policy and audit (orchestrator directTurn).
 */

export type FastMode = 'off' | 'rules' | 'laya';

const APP_STOP_WORDS =
  /\b(?:and|then|with|folder|file|files|document|website|site|url|link|tab|page|chat|conversation|email|mail|settings|my|the last|it|that|this)\b/;

/** Exact phrasings → one tool. The text is normalised first (no "please", "Jarvis", punctuation). */
export function ruleMatch(raw: string): DirectAction | null {
  const t = normalizePhrase(raw);
  if (!t || t.split(' ').length > 6) return null;

  const app = /^(?:open|launch)\s+(?:up\s+)?(.{2,40})$/.exec(t)?.[1];
  if (app && app.split(' ').length <= 3 && !APP_STOP_WORDS.test(app))
    return { tool: 'open_app', input: { name: app }, ack: `Opening ${app}, sir.` };

  const level =
    /^(?:set\s+)?(?:the\s+)?volume\s+(?:to\s+|at\s+)?(\d{1,3})(?:\s*(?:percent|%))?$/.exec(t)?.[1];
  if (level && Number(level) <= 100)
    return { tool: 'set_volume', input: { level: Number(level) }, ack: `Volume ${level}.` };

  if (/^(?:mute|mute\s+(?:the\s+)?(?:sound|volume|audio|pc|computer))$/.test(t))
    return { tool: 'mute', input: { muted: true }, ack: 'Muted.' };
  if (/^(?:unmute|unmute\s+(?:the\s+)?(?:sound|volume|audio|pc|computer))$/.test(t))
    return { tool: 'mute', input: { muted: false }, ack: 'Sound is back on.' };

  if (/^(?:pause|play|resume)(?:\s+(?:the\s+)?(?:music|song|video|media|playback))?$/.test(t))
    return media('play_pause', 'Done.');
  if (/^(?:next|skip)(?:\s+(?:this\s+|the\s+)?(?:song|track))?$/.test(t))
    return media('next', 'Next one.');
  if (/^(?:previous|go back|last)\s+(?:song|track)$|^previous$/.test(t))
    return media('previous', 'Going back.');
  if (/^stop\s+(?:the\s+)?(?:music|song|playback)$/.test(t)) return media('stop', 'Stopped.');

  if (/^lock\s+(?:the\s+|my\s+)?(?:screen|pc|computer|laptop)$/.test(t))
    return { tool: 'lock_screen', input: {}, ack: 'Locking the screen.' };
  return null;
}

/** "What is 2+2?" → the calculator beside the orb with the sum worked out, and the answer said. */
export function mathMatch(raw: string): DirectAction | null {
  const expression = mathQuestion(raw);
  if (!expression) return null;
  return {
    tool: 'show_panel',
    input: { panel: { kind: 'calculator', expression } },
    ack: `That's ${formatResult(evaluate(expression))}, sir.`,
  };
}

const media = (action: string, ack: string): DirectAction => ({
  tool: 'media_control',
  input: { action },
  ack,
});

/** What Laya may pick, with how it reads each choice. `other` always means: ask Claude. */
export const LAYA_ACTIONS: Record<string, { criteria: string; action: DirectAction | null }> = {
  play_pause: {
    criteria: 'pause or resume the music or video that is playing',
    action: media('play_pause', 'Done.'),
  },
  next: { criteria: 'skip to the next song or track', action: media('next', 'Next one.') },
  previous: {
    criteria: 'go back to the previous song or track',
    action: media('previous', 'Going back.'),
  },
  mute: {
    criteria: 'silence the computer sound completely',
    action: { tool: 'mute', input: { muted: true }, ack: 'Muted.' },
  },
  unmute: {
    criteria: 'turn the computer sound back on',
    action: { tool: 'mute', input: { muted: false }, ack: 'Sound is back on.' },
  },
  other: {
    criteria: 'anything else: a question, a chat, a task, or a request needing more detail',
    action: null,
  },
};

/** Laya must be at least this sure, and well ahead of the runner-up. */
export const LAYA_MIN = 0.85;
const LAYA_MARGIN = 0.5;
/** Longer requests are rarely a bare media or sound command. */
const LAYA_MAX_WORDS = 9;

export function createFastPath(deps: {
  mode(): FastMode;
  /** Laya's probabilities for each LAYA_ACTIONS key; null while loading, slow or not installed. */
  classify?(text: string): Promise<Record<string, number> | null>;
  /** A custom assistant name ("Summer, open Spotify"); "Jarvis" is always understood. */
  assistantName?(): string;
  logger: Logger;
}) {
  const log = deps.logger.child({ module: 'fast-path' });
  return async function fastPath(said: string): Promise<DirectAction | null> {
    const mode = deps.mode();
    if (mode === 'off') return null;
    const name = deps.assistantName?.().trim().toLowerCase();
    const text =
      name && said.trim().toLowerCase().startsWith(name)
        ? said
            .trim()
            .slice(name.length)
            .replace(/^[\s,.!:-]+/, '')
        : said;
    const rule = mathMatch(text) ?? ruleMatch(text);
    if (rule) {
      log.info({ tool: rule.tool, by: 'rules' }, 'fast path');
      return rule;
    }
    if (mode !== 'laya' || !deps.classify) return null;
    const words = normalizePhrase(text).split(' ').filter(Boolean).length;
    if (words === 0 || words > LAYA_MAX_WORDS) return null;
    const p = await deps.classify(text);
    if (!p) return null;
    const ranked = Object.entries(p).sort((a, b) => b[1] - a[1]);
    const [best, second] = [ranked[0], ranked[1]];
    if (!best || best[1] < LAYA_MIN || best[1] - (second?.[1] ?? 0) < LAYA_MARGIN) return null;
    const action = LAYA_ACTIONS[best[0]]?.action ?? null;
    // Only numbers are logged, never what was said.
    if (action)
      log.info({ tool: action.tool, by: 'laya', p: Math.round(best[1] * 100) / 100 }, 'fast path');
    return action;
  };
}

export type FastPath = ReturnType<typeof createFastPath>;
