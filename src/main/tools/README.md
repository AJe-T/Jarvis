# tools/

`types.ts` defines a Tool (Zod input, tier, guards, confirm details, run). `registry.ts` turns tools into
Claude tool definitions (plus web search). `executor.ts` is the only way a tool runs: parse input →
policy engine → confirmation broker (CONFIRM) → run with timeout/abort → untrusted wrapping → tool_calls row
+ audit → `tool_result`. `native/*` holds the Windows tools; they reach the OS only through `OsAdapter`
(`native/os.ts`), which tests replace with a recording fake. PowerShell always runs via `powershell.ts`
(`execFile` + `-EncodedCommand`, parameters as JSON in an env var).
