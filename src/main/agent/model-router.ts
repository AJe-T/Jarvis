import type { UsagePurpose } from '../db/repos/usage-repo';
import type { SettingsService } from '../settings/settings-service';

export type TurnPurpose = UsagePurpose;

const DEEP_TRIGGER = /\b(think hard|think deeply|deep dive|plan)\b/i;

/**
 * Work that needs the strongest model: reasoning, research and browsing, writing and code, documents.
 * Checked in code (no extra model call), so voice replies don't wait on a classifier.
 */
const HEAVY =
  /\b(?:think(?:ing)? (?:about|through|carefully)|reason(?:ing)?|research|analy[sz]e|analysis|investigate|compare|comparison|pros and cons|evaluate|review|debug|refactor|architecture|strategy|step[- ]by[- ]step|in detail|detailed|explain (?:why|how)|why (?:does|do|is|are|did)|summari[sz]e|summary of|browse|search (?:the )?(?:web|internet|online)|look (?:it |this |that )?up online|find out|news|read (?:this|the|that|my) (?:page|article|document|pdf|file|email|report)|go through|write (?:[\w-]+ ){0,3}(?:essay|report|article|blog|story|script|program|function|proposal|letter|code)|(?:write|fix|review|explain) (?:the |this |my )?code|coding|algorithm|solve|calculate|prove|derive|build (?:a|an|me)|create (?:a|an) (?:app|website|tool|skill|automation|presentation|document|spreadsheet|plan)|fill (?:out|in) (?:the|this|a) form|automate)\b/i;

/** "Yes", "go ahead", "try again": a reply to the last answer stays on the model that gave it. */
const FOLLOW_UP =
  /^(?:yes|yeah|yep|yup|ok|okay|sure|go ahead|do it|do that|continue|carry on|keep going|go on|proceed|try again|retry|again|more|fix it|please do|sounds good|and then)\b/i;

/** Up to this many words, a request without heavy words is conversation or a quick command. */
export const LIGHT_MAX_WORDS = 12;
/** Past this many words a request is long enough to be real work. */
const HEAVY_MIN_WORDS = 60;
const FOLLOW_UP_MAX_WORDS = 6;

export type TurnWeight = 'light' | 'normal' | 'heavy' | 'follow-up';

/** How much model a chat or voice request needs, judged from its words alone. */
export function turnWeight(text: string): TurnWeight {
  const t = text.trim();
  const words = t ? t.split(/\s+/).length : 0;
  if (DEEP_TRIGGER.test(t) || HEAVY.test(t) || words > HEAVY_MIN_WORDS || /```|\n.*\n/.test(t))
    return 'heavy';
  if (words <= FOLLOW_UP_MAX_WORDS && FOLLOW_UP.test(t)) return 'follow-up';
  return words <= LIGHT_MAX_WORDS ? 'light' : 'normal';
}

/** API-Guide.md §3.6. Model IDs are settings, never constants. */
export function pickModel(
  settings: Pick<SettingsService, 'get'>,
  turn: {
    purpose: TurnPurpose;
    text?: string;
    deep?: boolean;
    /** Model that gave the last answer in this conversation (a "yes, do it" stays on it). */
    previous?: string | null;
  },
): string {
  if (
    turn.purpose === 'curator' ||
    turn.purpose === 'title' ||
    turn.purpose === 'summary' ||
    turn.purpose === 'intent'
  )
    return settings.get('models.fast');
  if (turn.purpose === 'desktop_agent') return settings.get('models.computer');
  if (turn.deep || (turn.text && DEEP_TRIGGER.test(turn.text))) return settings.get('models.deep');
  // Sir's chats and voice: the lightest model talks and runs quick commands, the deep one works.
  if (turn.purpose === 'chat' && turn.text !== undefined && settings.get('models.auto')) {
    const weight = turnWeight(turn.text);
    if (weight === 'heavy') return settings.get('models.deep');
    if (weight === 'light') return settings.get('models.fast');
    if (weight === 'follow-up' && turn.previous) return turn.previous;
  }
  return settings.get('models.default');
}
