# mcp/

MCP client manager (API-Guide.md §8). `manager.ts` connects stdio/HTTP servers from the `mcp_servers`
table, lists their tools, exposes them to the registry as `mcp__<server>__<tool>` (CONFIRM unless the
server's overrides say otherwise), calls them with a 60 s timeout, wraps output as untrusted, and
reconnects crashed servers with backoff (1 s → 16 s, 5 tries). Presets live in `src/shared/mcp-presets.ts`.
