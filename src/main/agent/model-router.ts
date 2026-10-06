import type { SettingsService } from '../settings/settings-service';

export type TurnPurpose = 'chat' | 'curator' | 'title' | 'summary' | 'desktop_agent' | 'eval';

const DEEP_TRIGGER = /\b(think hard|think deeply|deep dive|plan)\b/i;

/** API-Guide.md §3.6. Model IDs are settings, never constants. */
export function pickModel(
  settings: Pick<SettingsService, 'get'>,
  turn: { purpose: TurnPurpose; text?: string; deep?: boolean },
): string {
  if (turn.purpose === 'curator' || turn.purpose === 'title' || turn.purpose === 'summary')
    return settings.get('models.fast');
  if (turn.purpose === 'desktop_agent') return settings.get('models.computer');
  if (turn.deep || (turn.text && DEEP_TRIGGER.test(turn.text))) return settings.get('models.deep');
  return settings.get('models.default');
}
