/** Voices for the Kokoro (on-device) and ElevenLabs (cloud) engines; shared with Settings → Voice. */
export const KOKORO_VOICES = [
  { id: 'bm_george', label: 'George (British man, warm)' },
  { id: 'bm_daniel', label: 'Daniel (British man, crisp)' },
  { id: 'bm_lewis', label: 'Lewis (British man, deep)' },
  { id: 'bm_fable', label: 'Fable (British man, storyteller)' },
  { id: 'bf_emma', label: 'Emma (British woman)' },
  { id: 'af_heart', label: 'Heart (American woman)' },
  { id: 'am_michael', label: 'Michael (American man)' },
] as const;
export type KokoroVoice = (typeof KOKORO_VOICES)[number]['id'];
export const KOKORO_VOICE_IDS = KOKORO_VOICES.map((v) => v.id) as [KokoroVoice, ...KokoroVoice[]];

/** Verified 2026-10 against elevenlabs.io/docs/overview/models. */
export const ELEVEN_MODELS = [
  { id: 'eleven_v4_turbo', label: 'Eleven v4 Turbo: high quality, about 100 ms (recommended)' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5: fastest (about 75 ms), cheapest' },
  { id: 'eleven_v4', label: 'Eleven v4: highest quality, slower' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2: steady, 29 languages' },
] as const;
export type ElevenModel = (typeof ELEVEN_MODELS)[number]['id'];
export const ELEVEN_MODEL_IDS = ELEVEN_MODELS.map((m) => m.id) as [ElevenModel, ...ElevenModel[]];

/** ElevenLabs default voices that suit Jarvis; any voice id from Sir's library works too. */
export const ELEVEN_VOICE_PRESETS = [
  { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel (British man, authoritative)' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George (British man, warm)' },
] as const;
export const ELEVEN_VOICE_RE = /^[A-Za-z0-9]{10,40}$/;
