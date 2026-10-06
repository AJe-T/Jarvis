import type { McpServerInput } from '@shared/ipc-contract';
import type { Tier } from '@shared/types';
import { newId, nowIso } from '../../lib/util';
import type { Db } from '../connection';

export interface McpServerRecord extends McpServerInput {
  id: string;
}

interface Row {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args_json: string;
  url: string | null;
  env_secret_names_json: string;
  auth_secret_name: string | null;
  enabled: number;
  trust_level: McpServerInput['trustLevel'];
  default_tier: Tier;
  tool_overrides_json: string;
}

function toRecord(r: Row): McpServerRecord {
  return {
    id: r.id,
    name: r.name,
    transport: r.transport,
    ...(r.command ? { command: r.command } : {}),
    args: JSON.parse(r.args_json) as string[],
    ...(r.url ? { url: r.url } : {}),
    envSecrets: JSON.parse(r.env_secret_names_json) as Record<string, string>,
    ...(r.auth_secret_name ? { authSecret: r.auth_secret_name } : {}),
    enabled: r.enabled === 1,
    trustLevel: r.trust_level,
    defaultTier: r.default_tier,
    toolOverrides: JSON.parse(r.tool_overrides_json) as Record<string, Tier>,
  };
}

export function createMcpRepo(db: Db) {
  const get = (id: string): McpServerRecord | undefined => {
    const r = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Row | undefined;
    return r ? toRecord(r) : undefined;
  };
  return {
    get,
    all(): McpServerRecord[] {
      return (db.prepare('SELECT * FROM mcp_servers ORDER BY name').all() as unknown as Row[]).map(
        toRecord,
      );
    },
    byName(name: string): McpServerRecord | undefined {
      const r = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as Row | undefined;
      return r ? toRecord(r) : undefined;
    },
    insert(s: McpServerInput): McpServerRecord {
      const id = newId('mcp_');
      const now = nowIso();
      db.prepare(
        `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, env_secret_names_json, auth_secret_name, enabled,
           trust_level, default_tier, tool_overrides_json, untrusted_output, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        id,
        s.name,
        s.transport,
        s.command ?? null,
        JSON.stringify(s.args),
        s.url ?? null,
        JSON.stringify(s.envSecrets),
        s.authSecret ?? null,
        s.enabled ? 1 : 0,
        s.trustLevel,
        s.defaultTier,
        JSON.stringify(s.toolOverrides),
        now,
        now,
      );
      return get(id) as McpServerRecord;
    },
    update(id: string, s: McpServerInput): McpServerRecord {
      db.prepare(
        `UPDATE mcp_servers SET name = ?, transport = ?, command = ?, args_json = ?, url = ?, env_secret_names_json = ?,
           auth_secret_name = ?, enabled = ?, trust_level = ?, default_tier = ?, tool_overrides_json = ?, updated_at = ? WHERE id = ?`,
      ).run(
        s.name,
        s.transport,
        s.command ?? null,
        JSON.stringify(s.args),
        s.url ?? null,
        JSON.stringify(s.envSecrets),
        s.authSecret ?? null,
        s.enabled ? 1 : 0,
        s.trustLevel,
        s.defaultTier,
        JSON.stringify(s.toolOverrides),
        nowIso(),
        id,
      );
      return get(id) as McpServerRecord;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    },
  };
}

export type McpRepo = ReturnType<typeof createMcpRepo>;
