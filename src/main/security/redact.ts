// Security.md §9: runs before anything is written to the vault, logs, audit log, or DB.

type Rule = { type: string; re: RegExp; check?: (match: string) => boolean };

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function looksLikeToken(s: string): boolean {
  return /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);
}

const RULES: Rule[] = [
  {
    type: 'private_key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { type: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { type: 'openai_key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { type: 'github_token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { type: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { type: 'huggingface_token', re: /\bhf_[A-Za-z0-9]{30,}/g },
  { type: 'telegram_token', re: /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g },
  { type: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    type: 'password',
    re: /\b(?:password|passwd|pwd|passcode)\b\s*(?:is\s*|[:=]\s*)["']?[^\s"',;]{3,}/gi,
  },
  {
    type: 'otp',
    re: /\b(?:otp|one[- ]time (?:code|password)|verification code|security code|2fa code|code)\b\W{0,3}(?:is\s*)?[:=]?\s*\d{4,8}\b/gi,
  },
  { type: 'card', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: luhnValid },
  { type: 'aadhaar', re: /(?<!\d[ -]?)\b[2-9]\d{3}[ -]\d{4}[ -]\d{4}\b(?![ -]?\d)/g },
  { type: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { type: 'hex_token', re: /\b[a-fA-F0-9]{32,}\b/g },
  { type: 'token', re: /\b[A-Za-z0-9_-]{32,}\b/g, check: looksLikeToken },
  { type: 'token', re: /[A-Za-z0-9+/]{30,}={1,2}/g, check: looksLikeToken },
];

const knownSecrets = new Set<string>();

/** Exact secret values (from the secrets store) are always redacted, whatever their format. */
export function registerSecretValue(value: string): void {
  if (value.length >= 8) knownSecrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join('[REDACTED:secret]');
  }
  for (const rule of RULES) {
    out = out.replace(rule.re, (m) =>
      rule.check && !rule.check(m) ? m : `[REDACTED:${rule.type}]`,
    );
  }
  return out;
}

/** Deep-redacts every string inside a JSON-compatible value. Returns a new value. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => redactDeep(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}

const SENSITIVE_TYPES = new Set([
  'private_key',
  'anthropic_key',
  'openai_key',
  'github_token',
  'slack_token',
  'aws_key',
  'jwt',
  'password',
  'otp',
  'card',
  'aadhaar',
  'pan',
]);

/** Security.md §5 contentGuard: kinds of sensitive data present in text Jarvis is about to type or send. */
export function findSensitive(text: string): string[] {
  const found = new Set<string>();
  for (const secret of knownSecrets) if (text.includes(secret)) found.add('secret');
  for (const rule of RULES) {
    if (!SENSITIVE_TYPES.has(rule.type)) continue;
    for (const m of text.matchAll(rule.re)) {
      if (!rule.check || rule.check(m[0])) found.add(rule.type);
    }
  }
  return [...found];
}

export const __test = { luhnValid };
