# security/

Everything in Security.md that code enforces: redaction (`redact.ts`, `redact-content.ts`), kill switch,
and (Phase 2) the policy engine, path/shell/url/content guards, untrusted-content wrapping and the
hash-chained audit log. These modules are pure where possible and need 100% branch coverage.
