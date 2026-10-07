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
  /** ADR-010/013: 'api' = Anthropic API key; 'subscription' = Sir's Claude plan via Claude Code; 'local' = Ollama/LM Studio. */
  'llm.provider': {
    schema: z.enum(['api', 'subscription', 'local']),
    default: 'api' as 'api' | 'subscription' | 'local',
  },
  /** ADR-013: OpenAI-compatible server on this PC or the home network (Ollama, LM Studio). */
  'llm.local.baseUrl': { schema: z.string().url().max(200), default: 'http://localhost:11434/v1' },
  'llm.local.model': { schema: z.string().max(120), default: '' },
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
  /** ADR-012: seconds after a spoken reply during which Sir can follow up without the wake word (0 = off). */
  'voice.followUpSeconds': { schema: z.number().min(0).max(30), default: 6 },
  /** Pause (ms) that ends Sir's turn. Too short cuts him off mid-sentence. */
  'voice.endSilenceMs': { schema: z.number().int().min(300).max(3000), default: 1000 },
  /** The wake word may interrupt Jarvis while he talks. Off by default: without echo cancellation the
   * microphone hears Jarvis's own voice and he cuts himself off. The hotkey always interrupts. */
  'voice.bargeIn': { schema: z.boolean(), default: false },
  /** Priler/jarvis-style instant commands: routine trigger phrases, time and date answered offline. */
  'voice.quickCommands': { schema: z.boolean(), default: true },
  'voice.sounds': { schema: z.boolean(), default: true },
  // Everyday tools (ideas from isair/jarvis).
  /** Home town for weather ("Hyderabad, India"); empty = ask. */
  'location.home': { schema: z.string().max(120), default: '' },
  'units.temperature': {
    schema: z.enum(['celsius', 'fahrenheit']),
    default: 'celsius' as 'celsius' | 'fahrenheit',
  },
  /** Skills Sir turned off (by name); installed skills are on by default. */
  'skills.disabled': { schema: z.array(z.string().max(64)).max(500), default: [] as string[] },
  /** News feeds for read_feed and the briefing: "Name | https://url" per line (ideas from OpenJarvis). */
  'feeds.list': {
    schema: z.string().max(5000),
    default: [
      'Hacker News | https://hnrss.org/frontpage',
      'BBC World | https://feeds.bbci.co.uk/news/world/rss.xml',
    ].join('\n'),
  },
  /** Telegram channel (ideas from OpenJarvis): talk to Jarvis from Sir's phone via his own bot. */
  'telegram.enabled': { schema: z.boolean(), default: false },
  /** The one chat Jarvis answers (set by pairing); empty = not paired. */
  'telegram.chatId': { schema: z.string().regex(/^-?\d{0,20}$/), default: '' },
  'telegram.forwardAutomations': { schema: z.boolean(), default: true },
  'nutrition.dailyCalories': { schema: z.number().int().min(0).max(10000), default: 2000 },
  'hotkeys.ptt': { schema: accelerator, default: 'Ctrl+Alt+Space' },
  'hotkeys.toggleWindow': { schema: accelerator, default: 'Ctrl+Alt+J' },
  'hotkeys.kill': { schema: accelerator, default: 'Ctrl+Alt+Shift+X' },
  /** Dictation (ideas from isair/jarvis): press to start, speak, pause or press again to type it. */
  'hotkeys.dictation': { schema: accelerator, default: 'Ctrl+Alt+D' },
  /** Reply copilot (idea from jev-chat-jarvis): read the chat in front and help draft a reply. */
  'hotkeys.copilot': { schema: accelerator, default: 'Ctrl+Alt+R' },
  'copilot.enabled': { schema: z.boolean(), default: true },
  'dictation.enabled': { schema: z.boolean(), default: false },
  'dictation.removeFillers': { schema: z.boolean(), default: true },
  /** "heard → written" fixes, one per line, e.g. "jarvis => JARVIS". */
  'dictation.dictionary': { schema: z.string().max(5000), default: '' },
  'dictation.keepHistory': { schema: z.boolean(), default: true },
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
  /** Hybrid keyword + meaning memory search with an on-device model (isair/jarvis idea). */
  'memory.semanticSearch': { schema: z.boolean(), default: true },
  /** Dark or light; system follows Windows (Settings → Personalisation → Colours). */
  'appearance.theme': {
    schema: z.enum(['system', 'dark', 'light']),
    default: 'system' as 'system' | 'dark' | 'light',
  },
  'onboarding.complete': { schema: z.boolean(), default: false },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const SettingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

/** Settings whose change must itself be confirmed by Sir in the UI (Security.md §5 step 4). */
/** Set only by main-process flows (e.g. Telegram pairing), never directly from the renderer. */
export const MAIN_ONLY_SETTINGS: readonly SettingKey[] = ['telegram.chatId'];

export const SENSITIVE_SETTINGS: readonly SettingKey[] = [
  'policy.overrides',
  'files.allowedRoots',
  'llm.provider',
];
