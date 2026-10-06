-- ADR-010: calls made through Sir's Claude subscription are tracked but don't count against the budget.
ALTER TABLE usage_ledger ADD COLUMN billing TEXT NOT NULL DEFAULT 'api' CHECK (billing IN ('api', 'subscription'));
