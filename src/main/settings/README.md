# settings/

`settings-service.ts`: typed, Zod-validated settings backed by the `settings` table (schemas and defaults
in `src/shared/settings.ts`). `secrets.ts`: API keys encrypted with Electron `safeStorage` (DPAPI) in
`%APPDATA%\Jarvis\secrets.bin`. Secret values never leave main and are registered with the redactor.
