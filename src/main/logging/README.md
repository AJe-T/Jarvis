# logging/

pino logger with redaction (paths + `redact()` on every string). Writes to `%APPDATA%\Jarvis\logs`, rotated
daily, 14 files kept. Silent under `JARVIS_TEST=1` unless `JARVIS_LOG_LEVEL` is set.
