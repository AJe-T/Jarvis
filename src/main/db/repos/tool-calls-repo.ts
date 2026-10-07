import type { Tier, ToolDecision, ToolSource, UiToolCall } from '@shared/types';
import { newId, nowIso } from '../../lib/util';
import type { Db, SqlValue } from '../connection';

export type DecidedBy =
  'policy' | 'user_click' | 'user_voice' | 'user_remote' | 'kill_switch' | 'timeout';
export type DbToolStatus = 'pending' | 'running' | 'success' | 'error' | 'not_run';

export interface ToolCallRow {
  id: string;
  conversation_id: string;
  tool_use_id: string;
  tool_name: string;
  toolset_name: string | null;
  source: ToolSource;
  input_json: string;
  human_summary: string;
  tier: Tier;
  decision: ToolDecision;
  decided_by: DecidedBy | null;
  status: DbToolStatus;
  output_preview: string | null;
  error: string | null;
  untrusted_output: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

export function toUiToolCall(r: ToolCallRow): UiToolCall {
  return {
    id: r.id,
    toolUseId: r.tool_use_id,
    toolName: r.tool_name,
    humanSummary: r.human_summary,
    tier: r.tier,
    status: r.status,
    decision: r.decision,
    inputPreview: r.input_json,
    ...(r.output_preview !== null ? { outputPreview: r.output_preview } : {}),
    ...(r.error !== null ? { error: r.error } : {}),
    ...(r.duration_ms !== null ? { durationMs: r.duration_ms } : {}),
    createdAt: r.created_at,
  };
}

export function createToolCallsRepo(db: Db) {
  const get = (id: string): ToolCallRow =>
    db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as unknown as ToolCallRow;

  return {
    get,
    create(r: {
      conversationId: string;
      toolUseId: string;
      toolName: string;
      toolsetName: string | null;
      source: ToolSource;
      inputJson: string;
      humanSummary: string;
      tier: Tier;
      decision: ToolDecision;
      decidedBy: DecidedBy | null;
      status: DbToolStatus;
    }): ToolCallRow {
      const id = newId('tc_');
      db.prepare(
        `INSERT INTO tool_calls (id, conversation_id, tool_use_id, tool_name, toolset_name, source, input_json,
           human_summary, tier, decision, decided_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        r.conversationId,
        r.toolUseId,
        r.toolName,
        r.toolsetName,
        r.source,
        r.inputJson,
        r.humanSummary,
        r.tier,
        r.decision,
        r.decidedBy,
        r.status,
        nowIso(),
      );
      return get(id);
    },
    update(
      id: string,
      patch: Partial<
        Pick<
          ToolCallRow,
          | 'decision'
          | 'decided_by'
          | 'status'
          | 'output_preview'
          | 'error'
          | 'untrusted_output'
          | 'started_at'
          | 'finished_at'
          | 'duration_ms'
        >
      >,
    ): ToolCallRow {
      const keys = Object.keys(patch) as Array<keyof typeof patch>;
      if (keys.length > 0) {
        const sets = keys.map((k) => `${k} = ?`).join(', ');
        db.prepare(`UPDATE tool_calls SET ${sets} WHERE id = ?`).run(
          ...keys.map((k) => (patch[k] ?? null) as SqlValue),
          id,
        );
      }
      return get(id);
    },
    byToolUseIds(ids: string[]): ToolCallRow[] {
      if (ids.length === 0) return [];
      return db
        .prepare(
          `SELECT * FROM tool_calls WHERE tool_use_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`,
        )
        .all(...ids) as unknown as ToolCallRow[];
    },
    list(limit: number, conversationId?: string): ToolCallRow[] {
      return (conversationId
        ? db
            .prepare(
              'SELECT * FROM tool_calls WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?',
            )
            .all(conversationId, limit)
        : db
            .prepare('SELECT * FROM tool_calls ORDER BY created_at DESC LIMIT ?')
            .all(limit)) as unknown as ToolCallRow[];
    },
  };
}

export type ToolCallsRepo = ReturnType<typeof createToolCallsRepo>;
