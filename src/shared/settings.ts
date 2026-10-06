import { z } from 'zod';
import { TIERS, VOICE_MODES } from './types';

export const PriceSchema = z.object({
  inPerMTok: z.number().nonnegative(),
  outPerMTok: z.number().nonnegative(),
  cacheReadPerMTok: z.number().nonnegative(),
  cacheWritePerMTok: z.number().nonnegative(),
});
export type Price = z.infer<typeof PriceSchema>;

const modelId = z.string().min(3).max(100);
const accelerator = z.string().min(1).max(60);

/**
 * Every persisted setting: key → schema + default (API-Guide.md §10).
 * Paths that depend on the machine (vault, allowed roots) default to empty and are seeded by main on first run.
 */
export const SETTINGS = {
  /** ADR-010: 'api' = Anthropic API key; 'subscription' = Sir's Claude plan via his signed-in Claude Code. */
  'llm.provider': {
    schema: z.enum(['api', 'subscription']),
    default: 'api' as 'api' | 'subscription',
  },
  'models.default': { schema: modelId, default: 'claude-sonnet-5-5' },
  'models.deep': { schema: modelId, default: 'claude-opus-5-5' },
  'models.fast': { schema: modelId, default: 'claude-haiku-4-5-20251001' },
  'models.computer': { schema: modelId, default: 'claude-sonnet-5-5' },
  'budget.dailyUsd': { schema: z.number().min(0).max(1000), default: 2 },
  'budget.monthlyUsd': { schema: z.number().min(0).max(10000), default: 30 },
  'budget.perTurnInputTokens': { schema: z.number().int().min(1000), default: 200_000 },
  // Prices from platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-06). Editable in Settings.
  pricing: {
    schema: z.record(z.string(), PriceSchema),
    default: {
      'claude-sonnet-5-5': {
        inPerMTok: 2,
        outPerMTok: 10,
        cacheReadPerMTok: 0.2,
        cacheWritePerMTok: 2.5,
      },
      'claude-opus-5-5': {
        inPerMTok: 4,
        outPerMTok: 20,
        cacheReadPerMTok: 0.2,
        cacheWritePerMTok: 5,
      },
      'claude-haiku-4-5-20251001': {
        inPerMTok: 1,
        outPerMTok: 5,
        cacheReadPerMTok: 0.1,
        cacheWritePerMTok: 1.25,
      },
    } as Record<string, Price>,
  },
  'pricing.webSearchPerUse': { schema: z.number().min(0), default: 0.01 },
  'agent.maxIterations': { schema: z.number().int().min(1).max(100), default: 25 },
  'agent.computerMaxActions': { schema: z.number().int().min(1).max(200), default: 60 },
  'web.search.enabled': { schema: z.boolean(), default: true },
  'voice.mode': { schema: z.enum(VOICE_MODES), default: 'ptt' as (typeof VOICE_MODES)[number] },
  'voice.deviceIndex': { schema: z.number().int().min(-1), default: -1 },
  // ADR-011: cloud (Deepgram, Picovoice) or on-device (Whisper, openWakeWord), chosen separately.
  'voice.stt.provider': {
    schema: z.enum(['deepgram', 'whisper']),
    default: 'deepgram' as 'deepgram' | 'whisper',
  },
  'voice.stt.whisperModel': {
    schema: z.enum(['whisper-base.en', 'whisper-small.en', 'whisper-small']),
    default: 'whisper-small.en' as 'whisper-base.en' | 'whisper-small.en' | 'whisper-small',
  },
  'voice.wake.provider': {
    schema: z.enum(['picovoice', 'openwakeword']),
    default: 'picovoice' as 'picovoice' | 'openwakeword',
  },
  'voice.stt.language': { schema: z.string().min(2).max(10), default: 'en-IN' },
  'voice.tts.provider': { schema: z.enum(['edge', 'sapi']), default: 'edge' as 'edge' | 'sapi' },
  'voice.tts.voice': { schema: z.string().min(2).max(60), default: 'en-GB-RyanNeural' },
  'voice.tts.rate': { schema: z.string().regex(/^[+-]\d{1,3}%$/), default: '+5%' },
  'voice.wake.sensitivity': { schema: z.number().min(0).max(1), default: 0.6 },
  'voice.sounds': { schema: z.boolean(), default: true },
  'hotkeys.ptt': { schema: accelerator, default: 'Ctrl+Alt+Space' },
  'hotkeys.toggleWindow': { schema: accelerator, default: 'Ctrl+Alt+J' },
  'hotkeys.kill': { schema: accelerator, default: 'Ctrl+Alt+Shift+X' },
  'vault.path': { schema: z.string().max(400), default: '' },
  'files.allowedRoots': {
    schema: z.array(z.string().min(3).max(400)).max(50),
    default: [] as string[],
  },
  'policy.overrides': {
    schema: z.record(z.string(), z.enum(TIERS)),
    default: {} as Record<string, (typeof TIERS)[number]>,
  },
  'privacy.logConversationsToVault': { schema: z.boolean(), default: true },
  'retention.messagesDays': { schema: z.number().int().min(0).max(36500), default: 0 },
  'app.closeToTray': { schema: z.boolean(), default: true },
  'app.startWithWindows': { schema: z.boolean(), default: false },
  'app.startHidden': { schema: z.boolean(), default: false },
  'onboarding.complete': { schema: z.boolean(), default: false },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const SettingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

/** Settings whose change must itself be confirmed by Sir in the UI (Security.md §5 step 4). */
export const SENSITIVE_SETTINGS: readonly SettingKey[] = [
  'policy.overrides',
  'files.allowedRoots',
  'llm.provider',
];
