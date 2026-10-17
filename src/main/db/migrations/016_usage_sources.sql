-- Integrations step 5: usage per provider, connection and model, with where each price came from.
-- source: 'anthropic' (API key), 'claude-plan' (subscription), 'local' (this PC) or a connection id
-- (conn_openai, conn_openai_2…). price: 'live' (the provider's own list), 'table' (Settings →
-- pricing), 'fallback' (unknown: priced like the dearest Claude model, an over-estimate) or 'free'.
ALTER TABLE usage_ledger ADD COLUMN source TEXT;
ALTER TABLE usage_ledger ADD COLUMN price TEXT;
CREATE INDEX idx_usage_source ON usage_ledger(source, day);

-- Live prices from gateways that publish them (OpenRouter, Vercel AI Gateway), USD per million tokens.
ALTER TABLE ai_models ADD COLUMN in_per_mtok REAL;
ALTER TABLE ai_models ADD COLUMN out_per_mtok REAL;
ALTER TABLE ai_models ADD COLUMN cache_read_per_mtok REAL;
ALTER TABLE ai_models ADD COLUMN cache_write_per_mtok REAL;
