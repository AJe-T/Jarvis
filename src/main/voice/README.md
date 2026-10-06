# voice/

Main-process audio pipeline (ADR-007). `voice-controller.ts` is the state machine (Architecture.md §8):
mic loop (PvRecorder) → Porcupine wake word or press-to-talk → Deepgram live STT → orchestrator turn →
`tts-pipeline.ts` (spoken-block extraction, sentence chunking, Edge TTS with SAPI fallback) → `tts:audio`
events played by the renderer. Barge-in, silence timeout, spoken confirmations and local commands live in
the controller. `providers.ts` wraps the real SDKs; `fakes.ts` replaces them in tests (`JARVIS_TEST=1`,
`JARVIS_FAKE_TRANSCRIPTS="a|b"`). Latency timestamps are logged (wake→listening, EOS→final, final→audio).
