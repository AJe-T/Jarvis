-- Phase 5: HTTP MCP servers authenticate with a bearer token taken from the secrets store.
ALTER TABLE mcp_servers ADD COLUMN auth_secret_name TEXT;
