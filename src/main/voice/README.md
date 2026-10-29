# voice/

Main-process voice pipeline (ADR-007). Audio never reaches the main window's renderer; it only plays there.

**Microphone** (16 kHz mono Int16 frames, 512 samples, or 1280 for the openWakeWord-style engines):
- `voice.echoCancel` on (default): the hidden capture window (`windows/capture-window.ts`,
  `renderer/src/capture/capture.ts` + `mic-worklet.ts`) opens the mic with Chromium's echo
  cancellation (noise suppression / auto gain only if `voice.capture.*` are on) and an AudioWorklet
  posts frames to main, where `stream-recorder.ts` queues them. The device is opened by its saved
  Chromium id (`voice.captureDeviceId`), else its Windows name; a miss is reported, never silent.
  `mic-supervisor.ts` falls back to the native mic on failure and retries after 1 s, 3 s, 10 s.
- Off, or while that fails: PvRecorder (`providers.ts createPvRecorder`).

**Mic loop** (`voice-controller.ts loop`): reads one frame at a time and hands it to exactly one
consumer, never waiting on inference: an enrolment sample, the live speech-to-text session (straight
to it; frames that arrive while it connects are kept and replayed), a realtime conversation, the
always-listening transcriber, or the wake word.

**Wake word** (`voice.wake.provider`): `spotter` (default, sherpa-onnx keyword spotting, any name),
`openwakeword` ("Hey Jarvis"), `personal` (Sir's recorded phrases), `name` (Whisper on every phrase),
`picovoice` (Porcupine, key). The first three and the Silero voice detector run in the **audio
worker** (`audio-worker/`, a utility process): main posts frames and gets answers back in order
(`client.ts`); more than 2 s of unanswered frames are dropped and counted. The wake engine is reset
when listening ends, so the phrase that woke it can't fire again.

**Speech to text** (`voice.stt.provider`; the one really listening is shown in Settings): Deepgram
Nova-3 streams (`providers.ts`, events in `stt/deepgram-events.ts`); on-device Whisper / Moonshine /
Parakeet hear whole phrases cut by Silero VAD (`local/local-stt.ts`, models in the inference host);
Groq, OpenAI, ElevenLabs, AssemblyAI, an own server or Windows get finished phrases (`stt/cloud-stt.ts`).
A cloud engine without its key falls back to on-device speech, and Sir is told.

**Turn**: `route()` handles local commands (stop, sleep, yes/no for confirmations, instant answers),
otherwise `orchestrator.send` (source voice). Reply text streams into `tts-pipeline.ts`: the
`<spoken>` part, cut into sentences, synthesised by the chosen voice with fallbacks (Edge → Windows),
sent as `tts:audio` (MP3, WAV, or streamed PCM from Aura-2 / ElevenLabs, `tts/stream-tts.ts`) and played
by `renderer/src/audio/audio-player.ts`.

**Barge-in**: the hotkey always interrupts; the wake word does when `voice.bargeIn` is on, or with the
echo-cancelled mic once `echo-check.ts` saw Jarvis's replies stay out of the microphone.

**Realtime** (`voice.mode` realtime, `realtime/`): the wake word or hotkey opens an OpenAI Realtime or
Gemini Live conversation; tools still go through `tools/executor.ts`, spend through the budgets, and the
transcript is saved with `orchestrator.recordExternalTurn`.

**Diagnostics** (`diagnostics.ts`): dropped frames by reason, inference timing every 10 s, the voice
setup in effect, and with `voice.debugAudio` the exact frames each engine got as WAV files.

Tests: `fakes.ts` replaces the recorder, wake word, STT and TTS (`JARVIS_TEST=1`,
`JARVIS_FAKE_TRANSCRIPTS="a|b"`). Latency is logged per request (end of speech → transcript → first AI
word → first sound).
