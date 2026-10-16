/**
 * ADR-038: every speech-to-text and text-to-speech engine Sir can choose in Settings → Voice, with
 * the words shown next to each choice. Main and the renderer both read this list, so a new engine
 * is one entry here plus its provider. Nothing here is downloaded until Sir presses Download.
 * Cloud details verified 2026-10-15 against each provider's API docs (API-Guide.md §9).
 */

/** Plain-language tags shown on each card, so engines can be compared at a glance. */
export interface EngineFacts {
  /** "On this PC" or "Cloud": where the audio or text goes. */
  where: 'device' | 'cloud' | 'server';
  cost: string;
  speed: string;
  quality: string;
  languages: string;
}

export interface EngineInfo<Id extends string> extends EngineFacts {
  id: Id;
  title: string;
  /** One or two sentences: what it is good at and the catch. */
  body: string;
  /** Secret (Settings → Voice) the engine needs; none for on-device engines. */
  key?: string;
  keyLabel?: string;
  /** Where Sir gets a key or the program. */
  link?: string;
}

// ── Speech to text ─────────────────────────────────────────────────────────────────────────────

export const STT_ENGINE_IDS = [
  'whisper',
  'deepgram',
  'groq',
  'openai',
  'elevenlabs',
  'assemblyai',
  'server',
  'windows',
] as const;
export type SttEngineId = (typeof STT_ENGINE_IDS)[number];

export const STT_ENGINES: ReadonlyArray<EngineInfo<SttEngineId>> = [
  {
    id: 'whisper',
    title: 'On this PC (choose a model below)',
    body: 'Free, private and offline: audio never leaves the PC. Pick a small model for speed or a big one for accuracy; each is a one-time download.',
    where: 'device',
    cost: 'Free',
    speed: 'Depends on the model',
    quality: 'Depends on the model',
    languages: 'English, or 99 languages with a multilingual model',
  },
  {
    id: 'deepgram',
    title: 'Deepgram Nova-3',
    body: 'Live: words appear while you speak and replies start quickest. Audio goes to Deepgram only while Jarvis listens. New accounts get free credit.',
    key: 'deepgram',
    keyLabel: 'Deepgram API key',
    link: 'https://console.deepgram.com',
    where: 'cloud',
    cost: 'Paid (free starting credit)',
    speed: 'Fastest (streams live)',
    quality: 'Excellent',
    languages: 'English and many more',
  },
  {
    id: 'groq',
    title: 'Groq Whisper (free tier)',
    body: 'Whisper large-v3 on Groq’s very fast servers: near the best accuracy, back in about a second. Free tier with rate limits. Audio goes to Groq after you stop talking.',
    key: 'groq',
    keyLabel: 'Groq API key',
    link: 'https://console.groq.com/keys',
    where: 'cloud',
    cost: 'Free tier (paid above the limits)',
    speed: 'Very fast',
    quality: 'Excellent',
    languages: '99 languages',
  },
  {
    id: 'openai',
    title: 'OpenAI transcribe',
    body: 'GPT-4o transcribe models: very accurate with accents and noisy rooms. Paid per minute, cheap with the mini model. Audio goes to OpenAI after you stop talking.',
    key: 'openai',
    keyLabel: 'OpenAI API key',
    link: 'https://platform.openai.com/api-keys',
    where: 'cloud',
    cost: 'Paid (low cost per minute)',
    speed: 'Fast',
    quality: 'Excellent',
    languages: 'Most major languages',
  },
  {
    id: 'elevenlabs',
    title: 'ElevenLabs Scribe v2',
    body: 'Very accurate, strong with Indian languages. Uses the same ElevenLabs key as the voice. Audio goes to ElevenLabs after you stop talking.',
    key: 'elevenlabs',
    keyLabel: 'ElevenLabs API key',
    link: 'https://elevenlabs.io/app/settings/api-keys',
    where: 'cloud',
    cost: 'Paid (small free monthly quota)',
    speed: 'Fast',
    quality: 'Excellent',
    languages: '99 languages, incl. Hindi and Telugu',
  },
  {
    id: 'assemblyai',
    title: 'AssemblyAI Universal',
    body: 'Accurate cloud transcription with free starting credit. The slowest cloud choice here (upload, then wait), so better for dictation than quick commands.',
    key: 'assemblyai',
    keyLabel: 'AssemblyAI API key',
    link: 'https://www.assemblyai.com/dashboard',
    where: 'cloud',
    cost: 'Paid (free starting credit)',
    speed: 'Slower (2–5 s)',
    quality: 'Excellent',
    languages: '99 languages',
  },
  {
    id: 'server',
    title: 'Your own speech server',
    body: 'Any program that speaks OpenAI’s transcription API, on this PC or another one: Speaches (Faster-Whisper), NVIDIA Parakeet or Canary servers, LocalAI. Best with an NVIDIA GPU. Jarvis only connects; you install and run the server.',
    key: 'speech_server',
    keyLabel: 'Server API key (only if your server asks for one)',
    where: 'server',
    cost: 'Free (your hardware)',
    speed: 'Depends on the server',
    quality: 'Depends on the model',
    languages: 'Depends on the model',
  },
  {
    id: 'windows',
    title: 'Windows speech recognition',
    body: 'Built into Windows: no download, no key, offline. The least accurate choice and English only; handy as a backup.',
    where: 'device',
    cost: 'Free',
    speed: 'Fast',
    quality: 'Basic',
    languages: 'English (the Windows speech language)',
  },
];

/** On-device speech-to-text models (transformers.js; pinned in models.json). */
export const LOCAL_STT_MODEL_IDS = [
  'moonshine-tiny',
  'moonshine-base',
  'whisper-tiny.en',
  'whisper-tiny',
  'whisper-base.en',
  'whisper-base',
  'whisper-small.en',
  'whisper-small',
  'distil-small.en',
  'parakeet-ctc-0.6b',
  'distil-large-v3.5',
  'whisper-large-v3-turbo',
] as const;
export type LocalSttModelId = (typeof LOCAL_STT_MODEL_IDS)[number];

export interface LocalSttModel {
  id: LocalSttModelId;
  label: string;
  hint: string;
  /** Multilingual models take the language setting; English-only ones ignore it. */
  multilingual: boolean;
  speed: 'Fastest' | 'Very fast' | 'Fast' | 'Medium' | 'Slow';
  accuracy: 'Fair' | 'Good' | 'Very good' | 'Excellent';
  license: string;
}

export const LOCAL_STT_MODELS: readonly LocalSttModel[] = [
  {
    id: 'moonshine-tiny',
    label: 'Moonshine tiny',
    hint: 'The quickest model: built for short voice commands (no 30-second padding like Whisper). Great for the wake word by name. English only.',
    multilingual: false,
    speed: 'Fastest',
    accuracy: 'Fair',
    license: 'MIT',
  },
  {
    id: 'moonshine-base',
    label: 'Moonshine base',
    hint: 'Still very quick, and more accurate than Whisper base.en. A good everyday pick on a laptop. English only.',
    multilingual: false,
    speed: 'Very fast',
    accuracy: 'Good',
    license: 'MIT',
  },
  {
    id: 'whisper-tiny.en',
    label: 'Whisper tiny.en',
    hint: 'Smallest Whisper. Quick on any PC but often mishears names and accents. English only.',
    multilingual: false,
    speed: 'Very fast',
    accuracy: 'Fair',
    license: 'MIT',
  },
  {
    id: 'whisper-tiny',
    label: 'Whisper tiny (multilingual)',
    hint: 'Smallest multilingual Whisper: Hindi, Telugu and more on a slow PC, at basic accuracy.',
    multilingual: true,
    speed: 'Very fast',
    accuracy: 'Fair',
    license: 'MIT',
  },
  {
    id: 'whisper-base.en',
    label: 'Whisper base.en',
    hint: 'Fast (~1 s) and dependable. The default for the wake word by name, which hears every phrase. English only.',
    multilingual: false,
    speed: 'Fast',
    accuracy: 'Good',
    license: 'MIT',
  },
  {
    id: 'whisper-base',
    label: 'Whisper base (multilingual)',
    hint: 'Fast and multilingual: Hindi, Telugu and more; a little weaker at English than base.en.',
    multilingual: true,
    speed: 'Fast',
    accuracy: 'Good',
    license: 'MIT',
  },
  {
    id: 'whisper-small.en',
    label: 'Whisper small.en',
    hint: 'More accurate with Indian-accented English, but 2–4 s per sentence; on a slow PC the wake word lags. English only.',
    multilingual: false,
    speed: 'Medium',
    accuracy: 'Very good',
    license: 'MIT',
  },
  {
    id: 'whisper-small',
    label: 'Whisper small (multilingual)',
    hint: 'Also Hindi, Telugu and more; slightly weaker English than small.en.',
    multilingual: true,
    speed: 'Medium',
    accuracy: 'Very good',
    license: 'MIT',
  },
  {
    id: 'distil-small.en',
    label: 'Distil-Whisper small.en',
    hint: 'Nearly small.en’s accuracy with a much lighter decoder, so noticeably quicker. English only.',
    multilingual: false,
    speed: 'Fast',
    accuracy: 'Very good',
    license: 'MIT',
  },
  {
    id: 'parakeet-ctc-0.6b',
    label: 'NVIDIA Parakeet 0.6B',
    hint: 'Top-tier English accuracy that reads the whole phrase in one pass, so it stays quick on a CPU. Needs over 1 GB of free memory. English only.',
    multilingual: false,
    speed: 'Fast',
    accuracy: 'Excellent',
    license: 'CC-BY-4.0',
  },
  {
    id: 'distil-large-v3.5',
    label: 'Distil-Whisper large-v3.5',
    hint: 'Close to the biggest Whisper’s English accuracy at a fraction of the work. Slow on a laptop CPU; best on a fast desktop. English only.',
    multilingual: false,
    speed: 'Slow',
    accuracy: 'Excellent',
    license: 'MIT',
  },
  {
    id: 'whisper-large-v3-turbo',
    label: 'Whisper large-v3 turbo (multilingual)',
    hint: 'The most accurate local model, in 99 languages. Slow on a laptop CPU (several seconds per sentence); for a fast desktop.',
    multilingual: true,
    speed: 'Slow',
    accuracy: 'Excellent',
    license: 'MIT',
  },
];

export const GROQ_STT_MODELS = [
  { id: 'whisper-large-v3-turbo', label: 'Whisper large-v3 turbo: fastest (recommended)' },
  { id: 'whisper-large-v3', label: 'Whisper large-v3: a little more accurate, slower' },
] as const;
export const OPENAI_STT_MODELS = [
  {
    id: 'gpt-4o-mini-transcribe',
    label: 'GPT-4o mini transcribe: cheap and accurate (recommended)',
  },
  { id: 'gpt-4o-transcribe', label: 'GPT-4o transcribe: most accurate' },
  { id: 'whisper-1', label: 'Whisper-1: the original' },
] as const;

// ── Text to speech ─────────────────────────────────────────────────────────────────────────────

export const TTS_ENGINE_IDS = [
  'edge',
  'kokoro',
  'piper',
  'sapi',
  'elevenlabs',
  'openai',
  'aura',
  'groq',
  'server',
] as const;
export type TtsEngineId = (typeof TTS_ENGINE_IDS)[number];

export const TTS_ENGINES: ReadonlyArray<EngineInfo<TtsEngineId>> = [
  {
    id: 'edge',
    title: 'Microsoft Edge neural voices',
    body: 'Natural voices in many accents, free and quick. Uses Edge’s unofficial Read Aloud service, so it can stop working; Jarvis then falls back to the Windows voice.',
    where: 'cloud',
    cost: 'Free',
    speed: 'Fast',
    quality: 'Very natural',
    languages: '100+ languages and accents',
  },
  {
    id: 'kokoro',
    title: 'Kokoro (on this PC)',
    body: 'The best small open voice: natural and fully offline. One-time download (~330 MB) plus the free eSpeak NG program. First words take a second or two on a slow PC.',
    link: 'https://github.com/espeak-ng/espeak-ng/releases',
    where: 'device',
    cost: 'Free',
    speed: 'Medium',
    quality: 'Very natural',
    languages: 'English (British and American)',
  },
  {
    id: 'piper',
    title: 'Piper (on this PC, lightest)',
    body: 'Very light and much faster than Kokoro, even on an old laptop; a little less natural. Each voice is a small download (60–120 MB). Needs the free eSpeak NG program. Has Hindi and Telugu voices.',
    link: 'https://github.com/espeak-ng/espeak-ng/releases',
    where: 'device',
    cost: 'Free',
    speed: 'Very fast',
    quality: 'Good',
    languages: 'English, Hindi, Telugu',
  },
  {
    id: 'sapi',
    title: 'Windows voice',
    body: 'Built into Windows: instant, offline, nothing to set up. Sounds robotic.',
    where: 'device',
    cost: 'Free',
    speed: 'Fastest',
    quality: 'Robotic',
    languages: 'The voices installed in Windows',
  },
  {
    id: 'elevenlabs',
    title: 'ElevenLabs',
    body: 'The most lifelike voices, including your own cloned voice from your ElevenLabs library. What Jarvis says is sent to ElevenLabs.',
    key: 'elevenlabs',
    keyLabel: 'ElevenLabs API key',
    link: 'https://elevenlabs.io/app/settings/api-keys',
    where: 'cloud',
    cost: 'Paid (small free monthly quota)',
    speed: 'Fast',
    quality: 'Best',
    languages: 'Many languages',
  },
  {
    id: 'openai',
    title: 'OpenAI voices',
    body: 'Natural voices you can direct in plain words (“calm British butler”, “cheerful”). Cheap, paid per use. What Jarvis says is sent to OpenAI.',
    key: 'openai',
    keyLabel: 'OpenAI API key',
    link: 'https://platform.openai.com/api-keys',
    where: 'cloud',
    cost: 'Paid (low cost)',
    speed: 'Fast',
    quality: 'Very natural',
    languages: 'Most major languages',
  },
  {
    id: 'aura',
    title: 'Deepgram Aura-2',
    body: 'Clear, quick voices made for assistants, including British and Australian accents. Uses the same Deepgram key as speech-to-text.',
    key: 'deepgram',
    keyLabel: 'Deepgram API key',
    link: 'https://console.deepgram.com',
    where: 'cloud',
    cost: 'Paid (free starting credit)',
    speed: 'Very fast',
    quality: 'Natural',
    languages: 'English',
  },
  {
    id: 'groq',
    title: 'Groq Orpheus (expressive)',
    body: 'Expressive, conversational voices you can direct with tags like [cheerful] or [whisper], served fast on Groq’s free tier. American English only. What Jarvis says is sent to Groq.',
    key: 'groq',
    keyLabel: 'Groq API key',
    link: 'https://console.groq.com/keys',
    where: 'cloud',
    cost: 'Free tier (paid above the limits)',
    speed: 'Fast',
    quality: 'Expressive',
    languages: 'English',
  },
  {
    id: 'server',
    title: 'Your own voice server (cloning, expressive)',
    body: 'Any program that speaks OpenAI’s speech API: Chatterbox (voice cloning, MIT), Orpheus-FastAPI (expressive), XTTS v2 or F5-TTS via AllTalk / openedai-speech (cloning; non-commercial licences), Kokoro-FastAPI. These need an NVIDIA GPU to talk in real time. Jarvis only connects; you install and run the server.',
    key: 'speech_server',
    keyLabel: 'Server API key (only if your server asks for one)',
    where: 'server',
    cost: 'Free (your hardware)',
    speed: 'Depends on your GPU',
    quality: 'Up to cloned / expressive',
    languages: 'Depends on the model',
  },
];

export const PIPER_VOICES = [
  {
    id: 'piper-en_GB-northern_english_male-medium',
    label: 'Northern English man (British)',
    lang: 'en',
    license: 'CC-BY-SA-4.0',
  },
  {
    id: 'piper-en_GB-alan-medium',
    label: 'Alan (British man)',
    lang: 'en',
    license: 'Mimic 3 dataset licence',
  },
  {
    id: 'piper-en_GB-cori-high',
    label: 'Cori (British woman, high quality)',
    lang: 'en',
    license: 'Public domain',
  },
  {
    id: 'piper-en_US-john-medium',
    label: 'John (American man)',
    lang: 'en',
    license: 'Public domain',
  },
  { id: 'piper-en_US-joe-medium', label: 'Joe (American man)', lang: 'en', license: 'CC0' },
  {
    id: 'piper-en_US-ryan-high',
    label: 'Ryan (American man, high quality)',
    lang: 'en',
    license: 'CC-BY-NC-SA-4.0, personal use',
  },
  {
    id: 'piper-hi_IN-pratham-medium',
    label: 'Pratham (Hindi man)',
    lang: 'hi',
    license: 'CC-BY-NC-SA-4.0, personal use',
  },
  {
    id: 'piper-hi_IN-priyamvada-medium',
    label: 'Priyamvada (Hindi woman)',
    lang: 'hi',
    license: 'CC-BY-NC-SA-4.0, personal use',
  },
  {
    id: 'piper-te_IN-venkatesh-medium',
    label: 'Venkatesh (Telugu man)',
    lang: 'te',
    license: 'CC-BY-4.0',
  },
  {
    id: 'piper-te_IN-padmavathi-medium',
    label: 'Padmavathi (Telugu woman)',
    lang: 'te',
    license: 'CC-BY-4.0',
  },
] as const;
export type PiperVoice = (typeof PIPER_VOICES)[number]['id'];
export const PIPER_VOICE_IDS = PIPER_VOICES.map((v) => v.id) as [PiperVoice, ...PiperVoice[]];

export const OPENAI_TTS_MODELS = [
  { id: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS: follows your style note (recommended)' },
  { id: 'tts-1', label: 'TTS-1: quickest, ignores the style note' },
  { id: 'tts-1-hd', label: 'TTS-1 HD: higher fidelity, ignores the style note' },
] as const;
export const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;

/** Deepgram Aura-2 English voices (developers.deepgram.com/docs/tts-models, 2026-10-15). */
export const AURA_VOICES = [
  { id: 'aura-2-draco-en', label: 'Draco (British man)' },
  { id: 'aura-2-pandora-en', label: 'Pandora (British woman)' },
  { id: 'aura-2-hyperion-en', label: 'Hyperion (Australian man)' },
  { id: 'aura-2-theia-en', label: 'Theia (Australian woman)' },
  { id: 'aura-2-orion-en', label: 'Orion (American man)' },
  { id: 'aura-2-arcas-en', label: 'Arcas (American man)' },
  { id: 'aura-2-apollo-en', label: 'Apollo (American man)' },
  { id: 'aura-2-zeus-en', label: 'Zeus (American man)' },
  { id: 'aura-2-thalia-en', label: 'Thalia (American woman)' },
  { id: 'aura-2-asteria-en', label: 'Asteria (American woman)' },
  { id: 'aura-2-luna-en', label: 'Luna (American woman)' },
  { id: 'aura-2-amalthea-en', label: 'Amalthea (Filipino woman)' },
] as const;

/** Groq Orpheus English voices (console.groq.com/docs/text-to-speech/orpheus, 2026-10-15). */
export const GROQ_VOICES = [
  { id: 'daniel', label: 'Daniel (man)' },
  { id: 'troy', label: 'Troy (man)' },
  { id: 'austin', label: 'Austin (man)' },
  { id: 'hannah', label: 'Hannah (woman)' },
  { id: 'diana', label: 'Diana (woman)' },
  { id: 'autumn', label: 'Autumn (woman)' },
] as const;

// ── Downloadable models and speech servers ─────────────────────────────────────────────────────

/** Every model Settings can download (src/main/voice/local/models.json has exactly these). */
export const LOCAL_MODEL_IDS = [
  ...LOCAL_STT_MODEL_IDS,
  ...PIPER_VOICE_IDS,
  'openwakeword-hey-jarvis',
  'silero-vad',
  'minilm-embed',
  'minilm-rerank',
  'laya-multilingual',
  'kokoro-82m',
  'wavlm-speaker',
] as const;

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;
/** Link-local (incl. the 169.254.169.254 cloud metadata address) and metadata host names. */
const LINK_LOCAL =
  /^(169\.254(\.\d{1,3}){2}|\[fe[89ab][0-9a-f]:[^\]]*\]|metadata\.google\.internal)$/i;
const PRIVATE_LAN =
  /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;

/**
 * A speech server base URL (e.g. http://localhost:8000/v1). Plain http only to this PC or the home
 * network; anything else must be https, because audio, reply text and the key travel to it. No
 * user:password, query or fragment.
 */
export function isAllowedSpeechServer(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password || u.search || u.hash) return false;
  if (LINK_LOCAL.test(u.hostname)) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (LOOPBACK.test(u.hostname) || PRIVATE_LAN.test(u.hostname));
}

/** "http://localhost:8000/v1/" + "audio/speech" → "http://localhost:8000/v1/audio/speech". */
export function speechServerUrl(
  base: string,
  path: 'audio/speech' | 'audio/transcriptions',
): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}
