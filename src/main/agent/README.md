# agent/

Turn handling. `orchestrator.ts` queues turns (one at a time), persists messages, emits UI events and
runs the titler/summariser. `agent-loop.ts` is the Claude ↔ tools loop (API-Guide.md §3.4): every
`tool_use` gets exactly one `tool_result`, in order. `context-builder.ts` assembles the cached static
prompt, the per-turn dynamic block and the trimmed history. Gotcha: history is normalised before every
request (same-role messages merged, orphaned `tool_use` answered) so an interrupted turn can't cause a 400.
