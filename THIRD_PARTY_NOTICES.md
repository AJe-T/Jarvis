# Third-Party Notices

JARVIS does not copy source code from other projects (Code-style.md §10). This file lists
bundled third-party assets and separately-run components whose licences require notice.

| Component | URL | Licence | Where used |
|---|---|---|---|
| Geist (variable woff2) | https://github.com/vercel/geist-font | SIL OFL 1.1 | Interface font |
| Geist Mono (variable woff2) | https://github.com/vercel/geist-font | SIL OFL 1.1 | Code and label font |
| Playwright MCP (@playwright/mcp, run as a separate process via npx) | https://github.com/microsoft/playwright-mcp | Apache-2.0 | Browser connector |
| Notion MCP server (@notionhq/notion-mcp-server, optional, run via npx) | https://github.com/makenotion/notion-mcp-server | MIT | Notion connector |
| MCP filesystem server (@modelcontextprotocol/server-filesystem, optional, run via npx) | https://github.com/modelcontextprotocol/servers | MIT | Filesystem connector |
| Claude Agent SDK (@anthropic-ai/claude-agent-sdk 0.3.291) | https://code.claude.com/docs/en/agent-sdk/overview | Anthropic Commercial Terms (see package LICENSE.md) | Optional "Claude subscription" connection (ADR-010); runs Sir's installed Claude Code |
| openWakeWord (pipeline re-implemented in TypeScript, src/main/voice/local/open-wake-word.ts) | https://github.com/dscripka/openWakeWord | Apache-2.0 (code) | On-device wake word |
| openWakeWord models melspectrogram, embedding_model, hey_jarvis_v0.1 (downloaded on demand) | https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1 | CC BY-NC-SA 4.0 (non-commercial) | "Hey Jarvis" wake word |
| Silero VAD v6.2.3 model (downloaded on demand) | https://github.com/snakers4/silero-vad | MIT | End-of-speech detection for Whisper |
| Whisper tiny.en / tiny / base.en / base / small.en / small / large-v3-turbo, ONNX conversions by onnx-community (downloaded on demand) | https://huggingface.co/onnx-community | MIT (OpenAI Whisper weights) | On-device speech to text |
| Distil-Whisper small.en / large-v3.5, ONNX by onnx-community (downloaded on demand) | https://huggingface.co/distil-whisper | MIT | On-device speech to text |
| Moonshine tiny / base (Useful Sensors), ONNX by onnx-community (downloaded on demand) | https://huggingface.co/UsefulSensors | MIT | On-device speech to text |
| NVIDIA Parakeet CTC 0.6B, ONNX by onnx-community (downloaded on demand) | https://huggingface.co/nvidia/parakeet-ctc-0.6b | CC-BY-4.0 (attribution: NVIDIA) | On-device speech to text |
| WavLM base plus SV (Microsoft), ONNX by Xenova (downloaded on demand) | https://huggingface.co/microsoft/wavlm-base-plus-sv | CC-BY-SA-3.0 (UniSpeech licence; attribution: Microsoft) | Voice Match speaker fingerprints |
| Piper voices (rhasspy/piper-voices; downloaded on demand, one per voice) | https://huggingface.co/rhasspy/piper-voices | Repo MIT; each voice's dataset licence: northern_english_male CC-BY-SA-4.0, alan Mimic 3 dataset licence, cori and john public domain, joe CC0, ryan / pratham / priyamvada CC-BY-NC-SA-4.0 (non-commercial), venkatesh / padmavathi CC-BY-4.0 | On-device voices |
| Kokoro-82M v1.0 and voice packs, ONNX conversion by onnx-community (downloaded on demand) | https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX | Apache-2.0 | On-device neural voice |
| eSpeak NG (**not bundled**; Sir installs it, Jarvis runs it as a separate program) | https://github.com/espeak-ng/espeak-ng | GPL-3.0 | Text to phonemes for Kokoro and Piper |
| REA, rea-agents 6.4.0 (optional, **not bundled**; run via npx only when used) | https://github.com/morluto/rea | MIT | Reverse-engineering MCP server for Claude Code sessions and the Connections catalogue |
| Mermaid 12.2.0 | https://github.com/mermaid-js/mermaid | MIT | Diagrams in chat artifacts (renderer only, bundled by Vite) |
| HyperFrames, hyperframes 0.8.157 (optional, **not bundled**; run via npx only when `create_video` is used) | https://github.com/heygen-com/hyperframes | Apache-2.0 | Renders HTML compositions to video |
| unpdf 1.8.1 (bundles Mozilla pdf.js, Apache-2.0) | https://github.com/unjs/unpdf · https://github.com/mozilla/pdf.js | MIT (unpdf), Apache-2.0 (pdf.js) | `read_document`: text of PDF files |
| ms-marco-MiniLM-L-6-v2 cross-encoder, ONNX by Xenova (downloaded on demand) | https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2 | Apache-2.0 | Memory re-ranking |
| Cua Driver (optional, **not bundled**; Sir installs it, Jarvis runs `cua-driver mcp` as a separate process) | https://github.com/trycua/cua | MIT | Desktop-control MCP connection |
| @huggingface/transformers 4.3.1 | https://github.com/huggingface/transformers.js | Apache-2.0 | Runs Whisper |
| onnxruntime-node 1.30.0 | https://github.com/microsoft/onnxruntime | MIT | Runs the voice models |
| Picovoice Porcupine built-in keyword "Jarvis" | https://github.com/Picovoice/porcupine | Apache-2.0 | Wake word |
| Baileys 7.0.0-rc14 (npm `baileys`) | https://github.com/WhiskeySockets/Baileys | MIT | WhatsApp channel (linked device) |
| Tiptap 3.32.0 (@tiptap/react, core, pm, starter-kit, markdown, extension-list, extension-table, extensions) and ProseMirror | https://github.com/ueberdosis/tiptap | MIT | Spaces page editor (2.8) |
| qrcode 1.5.4 | https://github.com/soldair/node-qrcode | MIT | Pairing QR codes (phone remote, WhatsApp) |
| laya-ts 0.1.0 (built from laya tag v0.4.0, commit 3cf26cb; vendored as vendor/laya-ts-0.1.0-3cf26cb.tgz) | https://github.com/NandhaKishorM/laya/tree/main/laya-ts | Apache-2.0 | Runs the Laya listening filter (ADR-027) |
| laya-multilingual checkpoint (revision e4e9ddf), fp32 ONNX export, installed by hand | https://huggingface.co/convaiinnovations/laya-multilingual | Apache-2.0 | Laya listening filter (ADR-027) |

npm dependencies keep their own licence files inside `node_modules`; all production
dependencies are MIT / Apache-2.0 / BSD / ISC / OFL (checked at Phase 0, see docs/TRD.md §4).

## Projects whose ideas JARVIS re-implements (no code copied)

- **Tencent/WeKnora** — MIT (third-party parts under their own licences). Idea: read Office and PDF documents into plain text for the assistant.
- **vectorize-io/hindsight** — MIT. Ideas: re-rank fused memory search results with a cross-encoder; a "reflect" pass that turns many facts into evidence-linked observations.
- **ranxianglei/billion-context** — MIT plus an attribution term that applies to products using its software (Jarvis does not). Idea: bring back the exact messages a summary folded away.
- **affaan-m/ECC** — MIT. Idea (AgentShield): scan installed agent instructions for prompt injection.
- **anthropics/knowledge-work-plugins** (Apache-2.0), **K-Dense-AI/scientific-agent-skills** (MIT), **cathrynlavery/diagram-design** (MIT) — skill libraries Sir can install; downloaded to his PC on request, not bundled.
- **tashfeenahmed/freellmapi** — MIT. Works as an external OpenAI-compatible server for the Local model connection; not bundled.

- **ethanplusai/jarvis** — ideas: watching Claude Code sessions and saying when one waits on the user, starting sessions with a brief, plan usage windows.
- **kishanrajput23/Jarvis-Desktop-Voice-Assistant** — MIT. Idea: play music from the local library by voice.
- **hexgrad/kokoro / kokoro-js** — Apache-2.0. The phoneme clean-up rules for Kokoro follow kokoro-js's documented behaviour; Jarvis wrote its own runner.

- **LibreChat** (danny-avila / LibreChat-AI) — MIT. Ideas: artifacts, context usage and compaction, conversation search, ChatGPT/Claude import, subagents.
- **Open-LLM-VTuber** — MIT (Live2D assets under their own licence; not used). Ideas: emotion tags driving the avatar, interrupting without headphones, visual perception.
- **jo-inc/camofox-browser** — MIT. Ideas: accessibility snapshots with element refs, YouTube transcripts. Its anti-detection features were not taken.

- **isair/jarvis** — © 2025 Baris Sencan, "Jarvis AI Assistant License" (non-commercial; derivatives under the same terms). JARVIS studied its specs (transcript-first listening, intent judge, hot window, echo detection, dictation, everyday tools, local-model support) and wrote its own implementation. Because the ideas came from a non-commercial project, treat this app as personal / non-commercial.
- **open-jarvis/OpenJarvis** — Apache-2.0. Ideas: skills catalogue (agentskills.io format), morning digest and scheduled agents, deep research, channels (Telegram), news feeds.
- **microsoft/UFO** — MIT, and **Jeomon/Windows-Use** — MIT. Idea: drive Windows apps through their UI Automation tree before falling back to screenshots.
- **jev-chat/jev-chat-jarvis** — MIT, © 2026 Finderchangchang and the jev-chat contributors. Its NOTICE asks for credit: *Based on ideas from Jev Chat Assistant (https://github.com/jev-chat/jev-chat-jarvis)* — the reply copilot's analyse → stance → draft → check → fill flow and its scoring rule.

