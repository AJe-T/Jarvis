# llm/

`claude-client.ts` wraps the Anthropic SDK (error mapping, 30 s stream-idle retry). `fake-claude.ts` is
the scripted stand-in used when `JARVIS_TEST=1` (rules matched on the latest user text, see the file
header). `usage-ledger.ts` prices every response from the `pricing` setting; `budget-guard.ts` blocks calls
once a daily/monthly budget or the per-turn token ceiling is reached.
