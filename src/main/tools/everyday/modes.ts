import { z } from 'zod';
import { PERSONAS, PERSONA_IDS } from '@shared/personas';
import type { SettingsService } from '../../settings/settings-service';
import { defineTool, ok, type Tool } from '../types';

/** Long enough for a meeting or a nap; caps what injected text could silence (Security.md §6). */
const MAX_QUIET_MINUTES = 4 * 60;

/** When quiet mode ends, as Sir would say it ("until 3:40 pm"). */
export function quietLabel(until: number): string {
  return new Date(until).toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * How Jarvis behaves, switchable by voice:
 * - set_personality (sosoj92/jarvis-assistant-vocal "personnalités", Avinashb722 "Personality Manager").
 * - quiet_mode (BolisettySujith/J.A.R.V.I.S "be silent for a certain time"): until it ends, reminders,
 *   briefings and automations arrive silently in the app: no Windows pop-ups, nothing spoken.
 *   Replies when Sir talks to Jarvis are unchanged.
 * Both only change one of Sir's own settings, so SAFE.
 */
export function createModeTools(deps: { settings: SettingsService; now?: () => number }): Tool[] {
  const now = deps.now ?? Date.now;
  return [
    defineTool({
      name: 'set_personality',
      description: `Change how you talk, when sir asks ("be more concise", "be friendlier", "switch to sarcastic mode", "back to normal"). Personalities: ${PERSONAS.map((p) => `${p.id} (${p.hint})`).join('; ')}. 'butler' is the normal one. Takes effect from your next reply; your safety rules never change.`,
      input: z.object({ personality: z.enum(PERSONA_IDS) }),
      tier: 'SAFE',
      timeoutMs: 2_000,
      summarize: ({ personality }) => `Switch personality to ${personality}`,
      async run({ personality }) {
        deps.settings.set('persona', personality);
        const p = PERSONAS.find((x) => x.id === personality);
        return Promise.resolve(ok(`Personality is now ${p?.label ?? personality}.`));
      },
    }),
    defineTool({
      name: 'quiet_mode',
      description:
        'Quiet mode (do not disturb): for the next N minutes reminders, briefings and automations arrive silently in the app, with no Windows pop-ups and nothing spoken. Use for "be quiet for an hour", "don\'t disturb me until the meeting ends". minutes=0 turns it off; at most 240. Replies when sir talks to you are unchanged.',
      input: z.object({ minutes: z.number().int().min(0).max(MAX_QUIET_MINUTES) }),
      tier: 'SAFE',
      timeoutMs: 2_000,
      summarize: ({ minutes }) =>
        minutes ? `Quiet mode for ${minutes} min` : 'Turn quiet mode off',
      async run({ minutes }) {
        const until = minutes ? now() + minutes * 60_000 : 0;
        deps.settings.set('quiet.until', until);
        return Promise.resolve(
          ok(minutes ? `Quiet mode on until ${quietLabel(until)}.` : 'Quiet mode is off.'),
        );
      },
    }),
  ];
}
