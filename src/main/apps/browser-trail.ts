/**
 * Browser recipes (idea from ruflo's browser plugin: record a session once, replay it later; our own
 * code). Jarvis Browser actions that worked are kept per conversation, with each control described by
 * its role and name instead of a snapshot ref, so the steps still find it on a fresh page. Sir can
 * save them as a routine and run it again by name.
 */

/** A control as a recipe remembers it: what it is, not where it was. */
export interface BrowserTarget {
  role?: string | undefined;
  name: string;
}

export type BrowserStep =
  | { tool: 'jarvis_browser'; input: { action: 'open'; url: string } }
  | {
      tool: 'browser_act';
      input:
        | { action: 'click'; target: BrowserTarget }
        | { action: 'select'; target: BrowserTarget; option: string }
        | { action: 'press'; key: string }
        | { action: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom' };
    }
  | {
      tool: 'browser_type';
      input: { target: BrowserTarget; text: string; clear: boolean; submit: boolean };
    };

/** Steps kept per conversation (the newest ones). */
export const TRAIL_MAX_STEPS = 30;
const MAX_CONVERSATIONS = 20;

export function createBrowserTrail() {
  // ponytail: in memory, so a restart forgets unsaved trails; that is when Sir would save one anyway.
  const trails = new Map<string, BrowserStep[]>();
  return {
    record(conversationId: string, step: BrowserStep): void {
      const steps = [...(trails.get(conversationId) ?? []), step].slice(-TRAIL_MAX_STEPS);
      trails.delete(conversationId);
      trails.set(conversationId, steps);
      // Map keeps insertion order: drop the conversation used longest ago.
      if (trails.size > MAX_CONVERSATIONS) trails.delete(trails.keys().next().value as string);
    },
    get: (conversationId: string): BrowserStep[] => trails.get(conversationId) ?? [],
    /** The conversation that used the browser last, and its steps (the confirm dialog shows these). */
    mostRecent(): { conversationId: string; steps: BrowserStep[] } | null {
      const last = [...trails.entries()].at(-1);
      return last ? { conversationId: last[0], steps: last[1] } : null;
    },
    clear: (conversationId: string): void => void trails.delete(conversationId),
  };
}

export type BrowserTrail = ReturnType<typeof createBrowserTrail>;

/** Finds the control a recipe step means on the current page: exact name first, then a close one. */
export function findTarget<T extends { ref: string; role: string; name: string }>(
  refs: T[],
  target: BrowserTarget,
): T | undefined {
  const want = norm(target.name);
  if (!want) return undefined;
  const sameRole = target.role ? refs.filter((r) => r.role === target.role) : refs;
  return (
    sameRole.find((r) => norm(r.name) === want) ??
    sameRole.find((r) => norm(r.name).includes(want)) ??
    sameRole.find((r) => want.includes(norm(r.name)) && norm(r.name).length >= 3)
  );
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** One line per step, for the confirmation Sir sees before a recipe is saved. */
export function describeStep(s: BrowserStep): string {
  if (s.tool === 'jarvis_browser') return `Open ${s.input.url}`;
  if (s.tool === 'browser_type')
    return `Type "${s.input.text.slice(0, 60)}" into the ${label(s.input.target)}${s.input.submit ? ' and press Enter' : ''}`;
  const i = s.input;
  if (i.action === 'press') return `Press ${i.key}`;
  if (i.action === 'scroll') return `Scroll ${i.direction}`;
  if (i.action === 'select') return `Choose "${i.option}" in the ${label(i.target)}`;
  return `Click the ${label(i.target)}`;
}

function label(t: BrowserTarget): string {
  return `${t.role ?? 'control'} "${t.name.slice(0, 60)}"`;
}
