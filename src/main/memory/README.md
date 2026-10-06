# memory/

Jarvis's Obsidian "brain" (Database.md §8). `vault-service.ts` does all vault I/O (path-guarded,
redacted, atomic, merge-on-external-edit). `indexer.ts` + `vault-watcher.ts` keep the SQLite FTS index in
step with the vault. `memory-tool.ts` implements Claude's `memory_20250818` tool on `<vault>/Memory`.
`retriever.ts` builds the per-turn memory context. `conversation-logger.ts` writes daily logs,
`curator.ts` extracts durable facts after each turn (Haiku), `routines.ts` loads/runs `Routines/*.md`.
`memory-system.ts` wires it all together and hooks the orchestrator's turn-end.
