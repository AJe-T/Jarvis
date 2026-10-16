import type { AssistantState } from '@shared/types';

export const STATUS_LINE: Record<AssistantState, string> = {
  IDLE: 'Ready',
  LISTENING: 'Listening…',
  THINKING: 'Thinking…',
  ACTING: 'Working…',
  AWAITING_CONFIRMATION: 'Waiting for your decision',
  SPEAKING: 'Speaking…',
  ERROR: 'Something went wrong',
  SLEEP: 'Asleep',
};

const CAPTION_MAX = 320;

/** Reply text as a spoken-style caption: no tags, no Markdown marks or code, only the latest words. */
export function captionOf(text: string, max = CAPTION_MAX): string {
  const plain = text
    .replace(/<\/?spoken>/g, '')
    .replace(/<mood>[^<]{0,12}<\/mood>/gi, '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/[*_`#>|]/g, '')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `…${plain.slice(-max)}` : plain;
}
