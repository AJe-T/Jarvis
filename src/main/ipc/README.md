# ipc/

`handle.ts` registers invoke handlers: sender-frame check + Zod request/response validation (Security.md §7).
`emit.ts` sends typed events to app windows. Handlers per area live in `handlers/*.ts`; add the channel to
`src/shared/ipc-channels.ts` and its schema to `src/shared/ipc-contract.ts` first.
