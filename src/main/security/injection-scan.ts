/**
 * Prompt-injection scanner for untrusted content (idea from ruflo's ToolOutputGuardrail, ADR-131;
 * our own rules). Security.md §6: wrapping and taint already treat outside text as data; this adds a
 * signal when the text is *trying* to instruct an AI, so Sir sees it and the rest of the turn asks
 * before every action. Pure, synchronous, no model call. It finds the obvious attacks, not all of them:
 * the wrapper, taint and confirmations stay the real defence.
 */

export type InjectionSeverity = 'none' | 'medium' | 'high' | 'critical';

interface Rule {
  id: string;
  /** Shown to Sir in the confirm dialog: says what was found, never quotes the page. */
  label: string;
  severity: Exclude<InjectionSeverity, 'none'>;
  test: (text: string) => boolean;
}

const AI = String.raw`(?:ai|a\.i\.|llm|language model|assistant|agent|chat ?bot|claude|gpt|jarvis)`;
const ACT = `(?:send|e-?mail|forward|upload|post|open|click|run|execute|download|delete|remove|rename|move|transfer|pay|buy|reveal|share|visit|type|paste|schedule|install|disable|enable|create|close|call|accept|log ?in|remember)`;

const re = (source: string, flags = 'i'): ((t: string) => boolean) => {
  const r = new RegExp(source, flags);
  return (t) => r.test(t);
};

const RULES: Rule[] = [
  {
    id: 'override',
    label: 'tells the AI to ignore its instructions',
    severity: 'critical',
    test: re(
      String.raw`\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|system|original)\b[^.\n]{0,25}\b(?:instructions?|prompts?|rules|directions|guidelines|guardrails)\b`,
    ),
  },
  {
    id: 'wrapper-spoof',
    label: 'tries to break out of the "outside content" wrapper',
    severity: 'critical',
    test: re(String.raw`<\s*/?\s*untrusted[_-]content`),
  },
  {
    id: 'role-tokens',
    label: 'contains hidden chat-control markers',
    severity: 'critical',
    test: re(
      String.raw`<\|(?:im_start|im_end|system|endoftext|eot_id|start_header_id)\|>|\[/?INST\]|<<\s*SYS\s*>>`,
    ),
  },
  {
    id: 'tag-smuggling',
    label: 'contains invisible tag characters (hidden text)',
    severity: 'high',
    test: re(String.raw`[\u{E0020}-\u{E007F}]`, 'u'),
  },
  {
    id: 'directive-to-ai',
    label: 'gives the AI orders to act',
    severity: 'high',
    test: re(
      String.raw`\b${AI}s?\b[^.\n]{0,60}\b(?:must|should|need to|needs to|has to|have to|is instructed to|are instructed to|will now)\b[^.\n]{0,60}\b${ACT}\b`,
    ),
  },
  {
    id: 'addressed-to-ai',
    label: 'speaks to the AI directly and asks it to act',
    severity: 'high',
    test: re(
      // The name opens a sentence ("Jarvis, open…", "<!-- assistant: delete…"), or is @-mentioned.
      String.raw`(?:^|[\n>"'(]|[.!?:\-]\s+)(?:hey\s+|dear\s+)?${AI}\s*[,:]\s*[^\n]{0,80}?\b${ACT}\b|@${AI}\b[^\n]{0,80}?\b${ACT}\b|\b(?:for|to)\s+(?:the\s+)?${AI}\s*:\s*[^\n]{0,80}?\b${ACT}\b`,
      'im',
    ),
  },
  {
    id: 'stealth',
    label: 'asks for something to be done secretly',
    severity: 'high',
    test: re(
      String.raw`\b(?:quietly|silently|secretly|discreetly|without telling|without (?:sir|the user) (?:knowing|noticing))\b[^.\n]{0,30}\b${ACT}\b`,
    ),
  },
  {
    id: 'remote-code',
    label: 'tells you to run a script straight from the internet',
    severity: 'high',
    test: re(
      String.raw`\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^\n|]{0,160}\|\s*(?:iex|invoke-expression|sh|bash|powershell)\b`,
    ),
  },
  {
    id: 'fake-approval',
    label: 'claims actions are pre-approved or confirmations are off',
    severity: 'high',
    test: re(
      String.raw`\b(?:pre-?approved|already approved|without (?:asking|confirmation|confirming)|confirmations?(?: dialogs?)? (?:are|is) (?:now )?(?:disabled|off)|(?:the user|sir|your (?:owner|user)) wants you to|authori[sz]e you to|on (?:sir|the user|your (?:owner|user))'?s? behalf)\b`,
    ),
  },
  {
    id: 'system-impersonation',
    label: 'pretends to be a system message',
    severity: 'high',
    // Capitals only: "System: Windows 11" in a spec sheet is common, "SYSTEM:" rarely is.
    test: re(String.raw`^\s*\[?(?:SYSTEM|DEVELOPER)\]?\s*:`, 'm'),
  },
  {
    id: 'new-instructions',
    label: 'announces new instructions',
    severity: 'high',
    test: re(
      String.raw`\b(?:new|updated|real|actual|hidden|secret|additional)\s+(?:system\s+)?(?:instructions|prompt|directives|orders)\s*:|^\s*(?:#+\s*)?(?:system|developer)\s+(?:prompt|message|instructions?)\s*:`,
      'im',
    ),
  },
  {
    id: 'exfiltration',
    label: 'asks for passwords, keys or files to be sent somewhere',
    severity: 'high',
    test: re(
      String.raw`\b(?:send|e-?mail|forward|upload|post|paste|leak)\b[^.\n]{0,50}\b(?:passwords?|credentials?|api keys?|tokens?|cookies?|secrets?|ssh keys?|id_rsa|chat history|conversation|memory|files?|invoices?|documents?|contacts?|e-?mails?)\b[^\n]{0,50}?(?:\bto\b|\bat\b)\s*(?:[\w.+-]+@[\w-]+\.\w+|https?://|pastebin|a webhook)`,
    ),
  },
  {
    id: 'prompt-leak',
    label: 'asks the AI to reveal its instructions',
    severity: 'medium',
    test: re(
      String.raw`\b(?:reveal|print|show|repeat|output|tell me)\b[^.\n]{0,30}\b(?:system prompt|hidden instructions|your (?:initial |original )?instructions)\b`,
    ),
  },
  {
    id: 'jailbreak',
    label: 'uses jailbreak wording',
    severity: 'medium',
    test: re(String.raw`\b(?:jailbreak|DAN mode|developer mode (?:enabled|on)|do anything now)\b`),
  },
  {
    id: 'zero-width',
    label: 'hides text with invisible characters',
    severity: 'medium',
    test: (t) => (t.match(/[\u200B-\u200D\u2060\uFEFF]/g)?.length ?? 0) >= 8,
  },
];

const RANK: Record<InjectionSeverity, number> = { none: 0, medium: 1, high: 2, critical: 3 };

/** Large pages are scanned up to this many characters (attacks usually sit near the top or are repeated). */
export const MAX_SCAN_CHARS = 200_000;

export interface InjectionScan {
  severity: InjectionSeverity;
  /** Rule ids, safe to log: no page text. */
  rules: string[];
  /** Plain words for Sir ("tells the AI to ignore its instructions"). */
  labels: string[];
}

export function scanForInjection(text: string): InjectionScan {
  const t = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  const hits = RULES.filter((r) => r.test(t));
  const severity = hits.reduce<InjectionSeverity>(
    (worst, r) => (RANK[r.severity] > RANK[worst] ? r.severity : worst),
    'none',
  );
  return { severity, rules: hits.map((r) => r.id), labels: hits.map((r) => r.label) };
}

/** high and critical change behaviour (every action in the turn asks); medium is only recorded. */
export function isActionable(severity: InjectionSeverity): boolean {
  return RANK[severity] >= RANK.high;
}
