# Third-Party Notices

JARVIS does not copy source code from other projects (Code-style.md §10). This file lists
bundled third-party assets and separately-run components whose licences require notice.

| Component | URL | Licence | Where used |
|---|---|---|---|
| Chakra Petch (via @fontsource/chakra-petch) | https://fonts.google.com/specimen/Chakra+Petch | SIL OFL 1.1 | Display font |
| IBM Plex Sans (via @fontsource/ibm-plex-sans) | https://github.com/IBM/plex | SIL OFL 1.1 | Body font |
| JetBrains Mono (via @fontsource/jetbrains-mono) | https://github.com/JetBrains/JetBrainsMono | SIL OFL 1.1 | Code font |
| Playwright MCP (@playwright/mcp, run as a separate process via npx) | https://github.com/microsoft/playwright-mcp | Apache-2.0 | Browser connector |
| Notion MCP server (@notionhq/notion-mcp-server, optional, run via npx) | https://github.com/makenotion/notion-mcp-server | MIT | Notion connector |
| MCP filesystem server (@modelcontextprotocol/server-filesystem, optional, run via npx) | https://github.com/modelcontextprotocol/servers | MIT | Filesystem connector |
| Claude Agent SDK (@anthropic-ai/claude-agent-sdk 0.3.291) | https://code.claude.com/docs/en/agent-sdk/overview | Anthropic Commercial Terms (see package LICENSE.md) | Optional "Claude subscription" connection (ADR-010); runs Sir's installed Claude Code |
| openWakeWord (pipeline re-implemented in TypeScript, src/main/voice/local/open-wake-word.ts) | https://github.com/dscripka/openWakeWord | Apache-2.0 (code) | On-device wake word |
| openWakeWord models melspectrogram, embedding_model, hey_jarvis_v0.1 (downloaded on demand) | https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1 | CC BY-NC-SA 4.0 (non-commercial) | "Hey Jarvis" wake word |
| Silero VAD v6.2.3 model (downloaded on demand) | https://github.com/snakers4/silero-vad | MIT | End-of-speech detection for Whisper |
| Whisper base.en / small.en / small, ONNX conversions by onnx-community (downloaded on demand) | https://huggingface.co/onnx-community | MIT (OpenAI Whisper weights) | On-device speech to text |
| @huggingface/transformers 4.3.1 | https://github.com/huggingface/transformers.js | Apache-2.0 | Runs Whisper |
| onnxruntime-node 1.30.0 | https://github.com/microsoft/onnxruntime | MIT | Runs the voice models |
| Picovoice Porcupine built-in keyword "Jarvis" | https://github.com/Picovoice/porcupine | Apache-2.0 | Wake word |

npm dependencies keep their own licence files inside `node_modules`; all production
dependencies are MIT / Apache-2.0 / BSD / ISC / OFL (checked at Phase 0, see docs/TRD.md §4).
