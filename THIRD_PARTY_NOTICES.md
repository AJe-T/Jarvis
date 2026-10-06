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
| Picovoice Porcupine built-in keyword "Jarvis" | https://github.com/Picovoice/porcupine | Apache-2.0 | Wake word |

npm dependencies keep their own licence files inside `node_modules`; all production
dependencies are MIT / Apache-2.0 / BSD / ISC / OFL (checked at Phase 0, see docs/TRD.md §4).
