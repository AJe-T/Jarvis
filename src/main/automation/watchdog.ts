import type { TurnWatch } from '../agent/orchestrator';

/**
 * Automation watchdog (idea from ruflo's "Project Anatole" protector for unattended agents): an
 * automation runs while Sir may be away, so anything the safety layer held back is reported to him
 * afterwards instead of disappearing into the Activity log.
 */
export function awayReport(
  taskName: string,
  watch: Pick<TurnWatch, 'injection' | 'blocked' | 'unanswered'> | undefined,
): string | null {
  if (!watch) return null;
  const parts: string[] = [];
  if (watch.injection) parts.push(`it read ${watch.injection}`);
  if (watch.blocked.length) parts.push(`the safety policy blocked: ${list(watch.blocked)}`);
  if (watch.unanswered.length)
    parts.push(`these waited for your OK and were not done: ${list(watch.unanswered)}`);
  return parts.length ? `While running "${taskName}", ${parts.join('; ')}.` : null;
}

function list(items: string[]): string {
  const shown = items.slice(0, 3).join(', ');
  return items.length > 3 ? `${shown} and ${items.length - 3} more` : shown;
}
