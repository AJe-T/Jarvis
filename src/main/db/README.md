# db/

SQLite via Electron's built-in `node:sqlite` (ADR-009). `connection.ts`: pragmas, migrations (bundled as
raw SQL), `tx()` helper, backups via `VACUUM INTO`. All SQL lives in `repos/*`; other modules never write
SQL. `fts-query.ts` turns any text into a safe FTS5 `MATCH` expression. Tests must run on Electron's Node
(`npm test` does this) because system Node 22 lacks FTS5.
