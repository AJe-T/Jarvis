import { z } from 'zod';
import { DEFAULT_NAME } from './assistant-name';
import { TIERS, VOICE_MODES } from './types';
import {
  ELEVEN_MODEL_IDS,
  ELEVEN_VOICE_RE,
  KOKORO_VOICE_IDS,
  type ElevenModel,
  type KokoroVoice,
} from './voices';
import { DEFAULT_ORB_STYLE, ORB_STYLE_IDS } from './orb-styles';
import {
  CF_ACCOUNT_RE,
  CLOUD_PROVIDER_IDS,
  CONNECTION_ID_RE,
  type CloudProviderId,
} from './llm-providers';
import {
  MAX_CHAINS,
  PoolChainSchema,
  ROUTING_STRATEGY_IDS,
  ScoreWeightsSchema,
  type PoolChain,
  type RoutingStrategy,
} from './free-pool';
import {
  AURA_VOICES,
  GROQ_STT_MODELS,
  GROQ_VOICES,
  isAllowedSpeechServer,
  LOCAL_STT_MODEL_IDS,
  OPENAI_STT_MODELS,
  OPENAI_TTS_MODELS,
  OPENAI_VOICES,
  PIPER_VOICE_IDS,
  STT_ENGINE_IDS,
  TTS_ENGINE_IDS,
  WAKE_ENGINE_IDS,
  type LocalSttModelId,
  type PiperVoice,
  type SttEngineId,
  type TtsEngineId,
  type WakeEngineId,
} from './speech-engines';
import { DEFAULT_PERSONA, PERSONA_IDS } from './personas';
import { FORGE_REPO_RE } from './forge';

export const PriceSchema = z.object({
  inPerMTok: z.number().nonnegative(),
  outPerMTok: z.number().nonnegative(),
  cacheReadPerMTok: z.number().nonnegative(),
  cacheWritePerMTok: z.number().nonnegative(),
});
export type Price = z.infer<typeof PriceSchema>;

const modelId = z.string().min(3).max(100);
const accelerator = z.string().min(1).max(60);
/** ADR-038: https anywhere; plain http only to this PC or the home network. */
const speechServer = z
  .string()
  .max(200)
  .refine(isAllowedSpeechServer, 'Use https://, or http:// to this PC or your home network');
/** A model or voice name a speech server understands. */
const serverName = z.string().regex(/^[\w.:/@+-]{1,100}$/);

/**
 * Every persisted setting: key → schema + default (API-Guide.md §10).
 * Paths that depend on the machine (vault, allowed roots) default to empty and are seeded by main on first run.
 */
/** OpenAI Realtime models offered in Settings → Voice (voice fix 3). */
export const REALTIME_OPENAI_MODELS = [
  'gpt-realtime-mini',
  'gpt-realtime',
  'gpt-realtime-2.1',
] as const;

/**
 * Rough cost of one minute of realtime conversation: about 1,500 input tokens (Sir's audio plus the
 * conversation so far, re-read each reply) and 600 output tokens (the spoken answers). Grows in long
 * conversations.
 */
export function realtimeUsdPerMinute(p: { inPerMTok: number; outPerMTok: number }): number {
  return (1500 * p.inPerMTok + 600 * p.outPerMTok) / 1e6;
}

export const SETTINGS = {
  /**
   * ADR-010/013: 'api' = Anthropic API key; 'subscription' = Sir's Claude plan via Claude Code;
   * 'local' = Ollama/LM Studio; 'cloud' = another provider's API (OpenAI, Gemini, DeepSeek…).
   */
  'llm.provider': {
    schema: z.enum(['api', 'subscription', 'local', 'cloud']),
    default: 'api' as 'api' | 'subscription' | 'local' | 'cloud',
  },
  /** Which cloud provider (shared/llm-providers.ts) the 'cloud' connection uses. */
  'llm.cloud.provider': {
    schema: z.enum(CLOUD_PROVIDER_IDS),
    default: 'openai' as CloudProviderId,
  },
  /**
   * Model chosen for each provider. Every provider with a key and a model here is also a "brain"
   * Jarvis can hand sub-tasks to (delegate_task), whichever connection is his own.
   */
  'llm.cloud.models': {
    schema: z.partialRecord(z.enum(CLOUD_PROVIDER_IDS), z.string().max(120)),
    default: {} as Partial<Record<CloudProviderId, string>>,
  },
  /**
   * Integrations step 3: which of the provider's keys Jarvis's own brain uses (an extra
   * connection, conn_<provider>_<n>); '' = the provider's own key.
   */
  'llm.cloud.connection': {
    schema: z.union([z.literal(''), z.string().regex(CONNECTION_ID_RE)]),
    default: '',
  },
  /**
   * ADR-045: Sir's Cloudflare Account ID, the only part of a cloud address he sets. Exactly 32
   * lowercase hex characters; code puts it into the fixed Workers AI address.
   */
  'llm.cloud.cloudflareAccount': {
    schema: z.union([z.literal(''), z.string().regex(CF_ACCOUNT_RE)]),
    default: '',
  },
  /** ADR-013: OpenAI-compatible server on this PC or the home network (Ollama, LM Studio). */
  'llm.local.baseUrl': { schema: z.string().url().max(200), default: 'http://localhost:11434/v1' },
  'llm.local.model': { schema: z.string().max(120), default: '' },
  /** API connection only: when Claude is busy or unreachable, the local model answers instead (idea from ruflo's provider failover). */
  'llm.fallbackLocal': { schema: z.boolean(), default: false },
  /** AI Router (2.30): the free pool Jarvis can hand non-private sub-tasks to (brain "free"). */
  'pool.enabled': { schema: z.boolean(), default: true },
  'pool.strategy': { schema: z.enum(ROUTING_STRATEGY_IDS), default: 'balanced' as RoutingStrategy },
  /** When tiers 1 and 2 are out of limits: ask Sir before a third-party AI, or never use one. */
  'pool.tier3': { schema: z.enum(['ask', 'never']), default: 'ask' as 'ask' | 'never' },
  /** Ask before every tier-3 answer (off = Sir may say yes until Jarvis restarts). */
  'pool.tier3EveryTime': { schema: z.boolean(), default: false },
  /** Per provider: switched off, or moved between tier 2 and 3. */
  'pool.providers': {
    schema: z.record(
      z.string().max(40),
      z.object({
        enabled: z.boolean().optional(),
        tier: z.union([z.literal(2), z.literal(3)]).optional(),
        /** Sir's own daily free allowance from the provider's console (AI Router → Usage). */
        tpd: z.number().int().positive().max(1e12).optional(),
        rpd: z.number().int().positive().max(1e9).optional(),
      }),
    ),
    default: {} as Record<string, { enabled?: boolean; tier?: 2 | 3; tpd?: number; rpd?: number }>,
  },
  /** Per model id (every provider serving it): switched off, and its place in the Priority order. */
  'pool.models': {
    schema: z.record(
      z.string().max(200),
      z.object({ enabled: z.boolean().optional(), order: z.number().int().optional() }),
    ),
    default: {} as Record<string, { enabled?: boolean; order?: number }>,
  },
  /** With several keys for one provider: the one with most room left first, or take turns. */
  'pool.keyOrder': {
    schema: z.enum(['roomiest', 'turns']),
    default: 'roomiest' as 'roomiest' | 'turns',
  },
  /** Hours between automatic key checks (0 = only when Sir clicks Check all keys). */
  'pool.checkHours': { schema: z.number().int().min(0).max(24), default: 6 },
  /** Phase 4 (2.34): the Custom strategy's weights. */
  'pool.weights': {
    schema: ScoreWeightsSchema,
    default: { reliability: 0.5, speed: 0.25, smarts: 0.25 },
  },
  /** Scores learn from the last week of answers, newer days counting more (half-life 2 days). */
  'pool.learn': { schema: z.boolean(), default: true },
  /** Free AIs get older tool output and repeated text trimmed, to fit their small limits. */
  'pool.shrink': { schema: z.boolean(), default: true },
  /** Named chains: an order of models for one kind of job (delegate_task "chain"). */
  'pool.chains': {
    schema: z.array(PoolChainSchema).max(MAX_CHAINS),
    default: [] as PoolChain[],
  },
  /** A model that answers with nothing counts as a miss and the next one is tried. */
  'pool.retryEmpty': { schema: z.boolean(), default: true },
  /** AI Router Phase 2 (2.32, Security.md §16.15): Claude may hand heavy non-private sub-tasks to brain "free". */
  'pool.delegation.delegate': { schema: z.boolean(), default: true },
  /** Short, plain, non-private chats skip Claude and go to a tier-2 free AI (rules in agent/front-door.ts). */
  'pool.delegation.frontDoor': { schema: z.boolean(), default: false },
  /** A conversation keeps the pool model that answered it for 30 minutes. */
  'pool.delegation.sticky': { schema: z.boolean(), default: true },
  /** When that model is out, the next one gets a short note of the free AIs' earlier answers (off: the question only). */
  'pool.delegation.handover': { schema: z.boolean(), default: true },
  /** Pool exhausted → Claude answers; Claude out of budget or limits → the pool answers non-private chats. */
  'pool.delegation.fallback': { schema: z.boolean(), default: true },
  /** Past 80% of today's Claude budget: the front door opens and Claude is told to delegate more. */
  'pool.delegation.budgetAware': { schema: z.boolean(), default: true },
  /** AI Router Phase 3 (2.33): free_web_search (Tavily → Brave → Exa → Firecrawl → Linkup) before Claude's paid search. */
  'pool.abilities.search': { schema: z.boolean(), default: true },
  /** generate_image: Cloudflare Workers AI, then (after Sir's yes) Pollinations as tier 3. */
  'pool.abilities.image': { schema: z.boolean(), default: true },
  /** Brain "fusion": three free models draft, a fourth judges (tier 2, text only). */
  'pool.abilities.fusion': { schema: z.boolean(), default: true },
  /** Speaking backup: Kokoro → Edge → ElevenLabs → Windows when a voice fails (reply text only). */
  'pool.abilities.voiceSpeaking': { schema: z.boolean(), default: true },
  /** Hearing backup: Whisper on this PC → Groq → OpenAI. Sends Sir's recorded voice out, so off by default. */
  'pool.abilities.voiceHearing': { schema: z.boolean(), default: false },
  'models.default': { schema: modelId, default: 'claude-sonnet-5-5' },
  'models.deep': { schema: modelId, default: 'claude-opus-5-5' },
  'models.fast': { schema: modelId, default: 'claude-haiku-4-5-20251001' },
  'models.computer': { schema: modelId, default: 'claude-sonnet-5-5' },
  'budget.dailyUsd': { schema: z.number().min(0).max(1000), default: 2 },
  'budget.monthlyUsd': { schema: z.number().min(0).max(10000), default: 30 },
  /** One automation run is stopped once it has cost this much (API-equivalent on the subscription); 0 = no cap. */
  /** Integrations step 5: a Compare AIs run that may cost more than this asks first (0 = always ask). */
  'budget.confirmRunUsd': { schema: z.number().min(0).max(100), default: 0.05 },
  'budget.automationRunUsd': { schema: z.number().min(0).max(100), default: 0.5 },
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
  /**
   * Voice v2 (default): a fixed, measured set of engines (src/main/voice/v2): the echo-cancelled mic
   * with Chromium's noise suppression and auto gain, software gain on the native mic, both on-device
   * wake words together, Deepgram when its key is set else the best on-device model, never Windows
   * speech. 'classic' keeps every engine choice of Settings → Voice as before.
   */
  'voice.engine': { schema: z.enum(['v2', 'classic']), default: 'v2' as 'v2' | 'classic' },
  'voice.deviceIndex': { schema: z.number().int().min(-1), default: -1 },
  // ADR-011/038: cloud, on-device or Sir's own server, chosen separately (shared/speech-engines.ts).
  'voice.stt.provider': {
    schema: z.enum(STT_ENGINE_IDS),
    default: 'deepgram' as SttEngineId,
  },
  /** The on-device model ('whisper' engine): Whisper, Moonshine or Parakeet. Key kept for saved settings. */
  'voice.stt.whisperModel': {
    schema: z.enum(LOCAL_STT_MODEL_IDS),
    default: 'whisper-small.en' as LocalSttModelId,
  },
  'voice.stt.groqModel': {
    schema: z.enum(GROQ_STT_MODELS.map((m) => m.id) as [string, ...string[]]),
    default: 'whisper-large-v3-turbo',
  },
  'voice.stt.openaiModel': {
    schema: z.enum(OPENAI_STT_MODELS.map((m) => m.id) as [string, ...string[]]),
    default: 'gpt-4o-mini-transcribe',
  },
  /** Base URL of Sir's OpenAI-compatible transcription server (…/v1). */
  'voice.stt.serverUrl': { schema: speechServer, default: 'http://localhost:8000/v1' },
  'voice.stt.serverModel': { schema: serverName, default: 'whisper-1' },
  /**
   * spotter = "Hey <name>" by on-device keyword spotting (ADR-044, any name, instant, the default),
   * picovoice = "Jarvis" (cloud key), openwakeword = "Hey Jarvis" (on-device model), name = any name Sir
   * chose, spotted by on-device Whisper, personal = Sir's own recorded "Hey <name>" (ADR-043, any
   * name, on-device). picovoice and openwakeword only know "Jarvis"; another name uses 'name' unless
   * Sir trained his personal wake word or chose the spotter.
   */
  'voice.wake.provider': {
    schema: z.enum(WAKE_ENGINE_IDS),
    default: 'spotter' as WakeEngineId,
  },
  'voice.stt.language': { schema: z.string().min(2).max(10), default: 'en-IN' },
  /** ADR-038: on-device (Kokoro, Piper, Windows), cloud, or Sir's own server (shared/speech-engines.ts). */
  'voice.tts.provider': {
    schema: z.enum(TTS_ENGINE_IDS),
    default: 'edge' as TtsEngineId,
  },
  'voice.tts.piperVoice': {
    schema: z.enum(PIPER_VOICE_IDS),
    default: 'piper-en_GB-northern_english_male-medium' as PiperVoice,
  },
  'voice.tts.openaiModel': {
    schema: z.enum(OPENAI_TTS_MODELS.map((m) => m.id) as [string, ...string[]]),
    default: 'gpt-4o-mini-tts',
  },
  'voice.tts.openaiVoice': {
    schema: z.enum(OPENAI_VOICES as unknown as [string, ...string[]]),
    default: 'onyx',
  },
  /** How the OpenAI voice should sound (gpt-4o-mini-tts only). */
  'voice.tts.openaiStyle': {
    schema: z.string().max(400),
    default: 'Speak like a calm, polite British butler: warm, clear and unhurried.',
  },
  'voice.tts.auraVoice': {
    schema: z.enum(AURA_VOICES.map((v) => v.id) as [string, ...string[]]),
    default: 'aura-2-draco-en',
  },
  'voice.tts.groqVoice': {
    schema: z.enum(GROQ_VOICES.map((v) => v.id) as [string, ...string[]]),
    default: 'daniel',
  },
  /** Base URL of Sir's OpenAI-compatible speech server (…/v1), e.g. Kokoro-FastAPI or Chatterbox. */
  'voice.tts.serverUrl': { schema: speechServer, default: 'http://localhost:8880/v1' },
  'voice.tts.serverModel': { schema: serverName, default: 'tts-1' },
  'voice.tts.serverVoice': { schema: serverName, default: 'alloy' },
  'voice.tts.kokoroVoice': {
    schema: z.enum(KOKORO_VOICE_IDS),
    default: 'bm_george' as KokoroVoice,
  },
  'voice.tts.elevenVoice': {
    schema: z.string().regex(ELEVEN_VOICE_RE),
    default: 'onwK4e9ZLuTAKqWW03F9',
  },
  'voice.tts.elevenModel': {
    schema: z.enum(ELEVEN_MODEL_IDS),
    default: 'eleven_v4_turbo' as ElevenModel,
  },
  'voice.tts.voice': { schema: z.string().min(2).max(60), default: 'en-GB-RyanNeural' },
  'voice.tts.rate': { schema: z.string().regex(/^[+-]\d{1,3}%$/), default: '+5%' },
  /**
   * ADR-039 Voice Match: answer the wake word by name and always-listening only when the voice
   * matches Sir's enrolled voice (Settings → Voice → Your voice). Not a security lock.
   */
  'voice.speaker.verify': { schema: z.boolean(), default: false },
  /** Similarity (0–1) a phrase needs to count as Sir; enrolment suggests one. */
  'voice.speaker.threshold': { schema: z.number().min(0.5).max(0.99), default: 0.8 },
  /** How on-device speech spelled the name while Sir enrolled ("sumer"); also wake Jarvis. */
  'voice.wake.learned': {
    schema: z.array(z.string().regex(/^[\p{L}\p{N}' ]{3,30}$/u)).max(6),
    default: [] as string[],
  },
  'voice.wake.sensitivity': { schema: z.number().min(0).max(1), default: 0.6 },
  /** ADR-044: the keyword-spotter level Sir's own "Hey <name>" recordings pass at (0 = not calibrated). */
  'voice.wake.spotterLevel': { schema: z.number().min(0).max(0.5), default: 0 },
  /** ADR-012: seconds after a spoken reply during which Sir can follow up without the wake word (0 = off). */
  'voice.followUpSeconds': { schema: z.number().min(0).max(30), default: 6 },
  /** Pause (ms) that ends Sir's turn. Too short cuts him off mid-sentence. */
  'voice.endSilenceMs': { schema: z.number().int().min(300).max(3000), default: 1000 },
  /** The wake word may interrupt Jarvis while he talks. Off by default: without echo cancellation the
   * microphone hears Jarvis's own voice and he cuts himself off. The hotkey always interrupts. */
  'voice.bargeIn': { schema: z.boolean(), default: false },
  /**
   * Echo-cancelled microphone (idea from Open-LLM-VTuber): the mic is opened in a hidden capture
   * window where Chromium removes Jarvis's own voice, so saying his name interrupts him even
   * without headphones. Off = the native recorder (no echo cancellation; barge-in by voice only with
   * 'voice.bargeIn'). Falls back to the native recorder by itself if the capture window can't open the mic.
   */
  'voice.echoCancel': { schema: z.boolean(), default: true },
  /**
   * Voice diagnostics: records the exact microphone frames given to speech-to-text and to the wake
   * word as WAV files in <userData>/debug-audio (Sir's voice, on this PC only; deleted at the next
   * start once switched off). Dropped frames and inference times are logged either way.
   */
  'voice.debugAudio': { schema: z.boolean(), default: false },
  /**
   * The echo-cancelled mic's Chromium deviceId for the chosen microphone, learned the first time
   * its Windows name matched (or picked in Settings → Voice when it didn't). Cleared when Sir
   * chooses another microphone.
   */
  'voice.captureDeviceId': { schema: z.string().max(300), default: '' },
  /**
   * Voice fix 1C: Chromium's noise suppression and automatic gain on the echo-cancelled mic. Off by
   * default: the wake-word and speech models were trained on plain audio, and gain "pumping" or
   * suppressed word endings make them miss. On helps a noisy room or a very quiet microphone.
   */
  'voice.capture.noiseSuppression': { schema: z.boolean(), default: false },
  'voice.capture.autoGain': { schema: z.boolean(), default: false },
  /**
   * Voice fix 3: realtime conversation (voice.mode 'realtime'). Sir's voice streams to this service
   * for the whole conversation and it answers in its own voice; paid per use, counted in the budgets.
   */
  'voice.realtime.provider': {
    schema: z.enum(['openai', 'gemini']),
    default: 'openai' as 'openai' | 'gemini',
  },
  'voice.realtime.openaiModel': {
    schema: z.enum(REALTIME_OPENAI_MODELS),
    default: 'gpt-realtime-mini' as (typeof REALTIME_OPENAI_MODELS)[number],
  },
  'voice.realtime.openaiVoice': { schema: z.string().regex(/^[a-z]{2,20}$/), default: 'cedar' },
  'voice.realtime.geminiModel': {
    schema: z.string().regex(/^[a-z0-9.-]{3,60}$/),
    default: 'gemini-3.8-live',
  },
  'voice.realtime.geminiVoice': { schema: z.string().regex(/^[A-Za-z]{2,20}$/), default: 'Charon' },
  /** A conversation ends by itself after this long (Gemini allows 15 minutes of audio). */
  'voice.realtime.maxMinutes': { schema: z.number().int().min(1).max(60), default: 10 },
  /**
   * Price per million tokens of each realtime model (audio dominates), used for the budget and the
   * per-minute estimate. Estimates as of 2026-10; correct them from the provider's pricing page.
   */
  'voice.realtime.prices': {
    schema: z.record(
      z.string(),
      z.object({ inPerMTok: z.number().min(0), outPerMTok: z.number().min(0) }),
    ),
    default: {
      'gpt-realtime-2.1': { inPerMTok: 32, outPerMTok: 64 },
      'gpt-realtime': { inPerMTok: 32, outPerMTok: 64 },
      'gpt-realtime-mini': { inPerMTok: 10, outPerMTok: 20 },
      'gemini-3.8-live': { inPerMTok: 3, outPerMTok: 12 },
    } as Record<string, { inPerMTok: number; outPerMTok: number }>,
  },
  /** Priler/jarvis-style instant commands: routine trigger phrases, time and date answered offline. */
  'voice.quickCommands': { schema: z.boolean(), default: true },
  'voice.sounds': { schema: z.boolean(), default: true },
  /**
   * Instant spoken replies with no model call: "Yes, sir?" when woken, "On it, sir." while a
   * request is being worked on. Off = the wake word starts listening at once (say it all in one breath).
   */
  'voice.greet': { schema: z.boolean(), default: true },
  /** When Jarvis starts: a spoken hello with the time and today's plan (no model call), then the mic opens. */
  'voice.startupGreeting': { schema: z.boolean(), default: true },
  // Everyday tools (ideas from isair/jarvis).
  /** Home town for weather ("Hyderabad, India"); empty = ask. */
  'location.home': { schema: z.string().max(120), default: '' },
  'units.temperature': {
    schema: z.enum(['celsius', 'fahrenheit']),
    default: 'celsius' as 'celsius' | 'fahrenheit',
  },
  /** Skills Sir turned off (by name); installed skills are on by default. */
  'skills.disabled': { schema: z.array(z.string().max(64)).max(500), default: [] as string[] },
  /** Skills Sir marked "Forge" (by name): their instructions join the boss's rules (F6). */
  'skills.forge': { schema: z.array(z.string().max(64)).max(50), default: [] as string[] },
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
  /** Apps → Scratchpad: notes Sir and Jarvis share (ADR-032). */
  'apps.scratchpad': { schema: z.string().max(20_000), default: '' },
  /** Who each chat is, remembered from the last reply ("whatsapp|priya" → friends/close). */
  'copilot.contacts': {
    schema: z.record(
      z.string().max(160),
      z.object({
        scene: z.enum(['work', 'romance', 'friends', 'family', 'general']),
        relationship: z.string().max(30),
      }),
    ),
    default: {},
  },
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
  /** Re-order found memories with an on-device cross-encoder when downloaded (hindsight idea). */
  'memory.rerank': { schema: z.boolean(), default: true },
  /** Weekly: the fast model looks across memory notes and writes patterns to Facts/Observations.md (hindsight "reflect"). */
  'memory.reflect': { schema: z.boolean(), default: true },
  /** ADR-027: on-device Laya decisions. 'shadow' runs beside Claude and only logs; 'on' acts on them. */
  /**
   * ADR-030 fast path for plain PC commands (no Claude call): 'rules' = exact phrasings only,
   * 'laya' = also loosely worded ones, understood on this PC by Laya when it is installed.
   */
  'agent.fastCommands': {
    schema: z.enum(['off', 'rules', 'laya']),
    default: 'laya' as 'off' | 'rules' | 'laya',
  },
  'laya.mode': {
    schema: z.enum(['off', 'shadow', 'on']),
    default: 'off' as 'off' | 'shadow' | 'on',
  },
  /** Dark, light or pitch black (OLED: true #000); system follows Windows (Settings → Personalisation → Colours). */
  'appearance.theme': {
    schema: z.enum(['system', 'dark', 'light', 'black']),
    default: 'system' as 'system' | 'dark' | 'light' | 'black',
  },
  /** Text size multiplier for the whole app (Settings → General → Text size); spacing stays put. */
  'appearance.fontScale': { schema: z.number().min(0.85).max(1.5), default: 1 },
  /** One accent colour the whole neon theme follows (Design-system.md §3.6); cyan is the default. */
  'appearance.accent': { schema: z.string().regex(/^#[0-9a-fA-F]{6}$/), default: '#00e5ff' },
  /** How the orb is drawn (Design-system.md §6.1; list in shared/orb-styles.ts). */
  'appearance.orbStyle': {
    schema: z.enum(ORB_STYLE_IDS),
    default: DEFAULT_ORB_STYLE,
  },
  /** The orb moves to music and other sound playing on this PC (levels only, never recorded). */
  'appearance.orbMusic': { schema: z.boolean(), default: true },
  /** The orb takes the colour of each reply's mood (calm, happy, concerned…; agent/mood.ts). */
  'appearance.orbMood': { schema: z.boolean(), default: true },
  /** Look of the whole app (Design-system.md §3.7): 'soft' = rounded and calm, 'cyberpunk' = Neon Grid HUD. */
  'appearance.style': {
    schema: z.enum(['soft', 'cyberpunk']),
    default: 'soft' as 'soft' | 'cyberpunk',
  },
  /** What Sir calls the assistant (Settings → General): the wake word, the name it answers to and calls itself. */
  'assistant.name': {
    schema: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^\p{L}[\p{L}' -]*$/u, 'Letters only, like April or Friday'),
    default: DEFAULT_NAME as string,
  },
  /** How Jarvis talks (shared/personas.ts); Sir can also switch it by voice (set_personality). */
  persona: {
    schema: z.enum(PERSONA_IDS),
    default: DEFAULT_PERSONA,
  },
  /**
   * Claude Code sessions on this PC (ethanplusai/jarvis): say so when one starts waiting on Sir
   * ('waiting'), also when one finishes ('all'), or never ('off').
   */
  'claudeCode.announce': {
    schema: z.enum(['off', 'waiting', 'all']),
    default: 'waiting' as 'off' | 'waiting' | 'all',
  },
  /** Quiet mode: until this time (epoch ms) Jarvis doesn't speak up or pop up on his own. 0 = off. */
  'quiet.until': { schema: z.number().int().min(0), default: 0 },
  /** Where the mini orb sits: the screen edge it is docked to and whether it is tucked away. */
  'mini.dock': {
    schema: z
      .object({
        px: z.number(),
        y: z.number(),
        side: z.enum(['left', 'right']),
        tucked: z.boolean(),
      })
      .nullable(),
    default: null as { px: number; y: number; side: 'left' | 'right'; tucked: boolean } | null,
  },
  'onboarding.complete': { schema: z.boolean(), default: false },
  /** Phone remote: a small HTTPS web app on the home network (off until Sir turns it on). */
  'remote.enabled': { schema: z.boolean(), default: false },
  'remote.port': { schema: z.number().int().min(1024).max(65535), default: 8765 },
  /** WhatsApp (Baileys, linked device): Sir messages himself ("Message yourself") to talk to Jarvis. */
  'whatsapp.enabled': { schema: z.boolean(), default: false },
  'whatsapp.forwardAutomations': { schema: z.boolean(), default: false },
  /** Messages to yourself must start with this word to reach Jarvis ("" = every message). */
  'whatsapp.prefix': { schema: z.string().max(20), default: 'Jarvis' },
  /** Telegram voice notes: reply with a spoken voice message as well as text. */
  'telegram.voiceReplies': { schema: z.boolean(), default: true },
  /** Spaces (Notion-style notebooks in <vault>/Spaces): icon per space name. */
  'spaces.icons': {
    schema: z.record(z.string().max(80), z.string().max(16)),
    default: {} as Record<string, string>,
  },
  /** Forge (docs/Forge.md): Sir's Jarvis repository on GitHub, set only through forge_setup (asks first). */
  'forge.repoUrl': {
    schema: z.union([z.literal(''), z.string().regex(FORGE_REPO_RE)]),
    default: '',
  },
  /** Forge: most Claude may spend on one run (Agent SDK estimate, also on Sir's plan). */
  'forge.budgetUsd': { schema: z.number().min(0.5).max(50), default: 5 },
  /** Forge F4: Claude hands small edits to free AIs (no-training ones first; the others only after Sir's yes). */
  'forge.freeWorkers': { schema: z.boolean(), default: true },
  /** Password manager: lock after this many idle minutes (0 = only when Sir locks it or Windows locks). */
  'passwords.autoLockMinutes': { schema: z.number().int().min(0).max(240), default: 5 },
  /** Copied passwords are wiped from the clipboard after this many seconds. */
  'passwords.clipboardSeconds': { schema: z.number().int().min(5).max(300), default: 20 },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const SettingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

/** Settings whose change must itself be confirmed by Sir in the UI (Security.md §5 step 4). */
/** Set only by main-process flows (e.g. Telegram pairing), never directly from the renderer. */
export const MAIN_ONLY_SETTINGS: readonly SettingKey[] = [
  'telegram.chatId',
  'mini.dock',
  'copilot.contacts',
  'forge.repoUrl',
];

/** Applied live, but a restart gives these a clean start (the Save bar offers one). */
export const RESTART_SETTINGS: readonly SettingKey[] = [
  'llm.provider',
  'vault.path',
  'memory.semanticSearch',
  // Voice engines and the microphone reload live, but a stale model or mic handle could leave
  // the wake word deaf until a restart; offering one is cheaper than Sir debugging it.
  'voice.mode',
  'voice.deviceIndex',
  'voice.echoCancel',
  'voice.wake.provider',
  'voice.wake.sensitivity',
  'voice.stt.provider',
  'voice.stt.whisperModel',
  'voice.tts.provider',
];

export const SENSITIVE_SETTINGS: readonly SettingKey[] = [
  'policy.overrides',
  'files.allowedRoots',
  'llm.provider',
  'llm.cloud.provider', // where the whole conversation is sent
  'llm.cloud.connection', // and with whose key
  // ADR-038: these decide where microphone audio and reply text are sent, so the audit keeps the value.
  'voice.stt.provider',
  'voice.tts.provider',
  'voice.realtime.provider', // where Sir's voice streams during a realtime conversation
  'voice.stt.serverUrl',
  'voice.tts.serverUrl',
  'pool.abilities.voiceHearing', // Sir's recorded voice to Groq / OpenAI when on-device speech fails
  'forge.repoUrl', // whose code Forge runs on this PC
];
