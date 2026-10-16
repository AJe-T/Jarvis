import type { Npc, NpcInput, NpcMeeting, NpcMessage } from '@shared/npcs';
import type { Db } from '../db/connection';
import { newId } from '../lib/util';

/** SQLite rows for NPCs, their chats and meetings (migration 013). */

interface NpcRow {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: Npc['color'];
  brain: Npc['brain'];
  instructions: string;
  tools_json: string;
  enabled: number;
  template_id: string | null;
  desk: number;
  conversation_id: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  channel: string;
  author: string;
  text: string;
  mentions_json: string;
  tainted: number;
  created_at: string;
}

interface MeetingRow {
  id: string;
  topic: string;
  attendees_json: string;
  status: NpcMeeting['status'];
  summary: string;
  created_at: string;
}

const nowIso = (): string => new Date().toISOString();

function parseList(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const toNpc = (r: NpcRow): Npc => ({
  id: r.id,
  name: r.name,
  role: r.role,
  emoji: r.emoji,
  color: r.color,
  brain: r.brain,
  instructions: r.instructions,
  tools: parseList(r.tools_json),
  enabled: r.enabled === 1,
  templateId: r.template_id,
  desk: r.desk,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toMessage = (r: MessageRow): NpcMessage => ({
  id: r.id,
  channel: r.channel,
  author: r.author,
  text: r.text,
  mentions: parseList(r.mentions_json),
  tainted: r.tainted === 1,
  createdAt: r.created_at,
});

const toMeeting = (r: MeetingRow): NpcMeeting => ({
  id: r.id,
  topic: r.topic,
  attendees: parseList(r.attendees_json),
  status: r.status,
  summary: r.summary,
  createdAt: r.created_at,
});

export function createNpcRepo(db: Db) {
  const row = (id: string): NpcRow | undefined =>
    db.prepare('SELECT * FROM npcs WHERE id = ?').get(id) as NpcRow | undefined;

  return {
    list: (): Npc[] =>
      (db.prepare('SELECT * FROM npcs ORDER BY desk').all() as unknown as NpcRow[]).map(toNpc),
    get: (id: string): Npc | null => {
      const r = row(id);
      return r ? toNpc(r) : null;
    },
    /** The hidden conversation an NPC's tool calls and costs attach to. */
    conversationOf: (id: string): string | null => row(id)?.conversation_id ?? null,

    create(input: NpcInput, conversationId: string): Npc {
      const id = newId('npc_');
      const now = nowIso();
      const used = new Set(
        (db.prepare('SELECT desk FROM npcs').all() as Array<{ desk: number }>).map((d) => d.desk),
      );
      let desk = 0;
      while (used.has(desk)) desk++;
      db.prepare(
        `INSERT INTO npcs (id, name, role, emoji, color, brain, instructions, tools_json, enabled,
          template_id, desk, conversation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.name,
        input.role,
        input.emoji,
        input.color,
        input.brain,
        input.instructions,
        JSON.stringify(input.tools),
        input.enabled ? 1 : 0,
        input.templateId,
        desk,
        conversationId,
        now,
        now,
      );
      return toNpc(row(id) as NpcRow);
    },

    update(id: string, input: NpcInput): Npc | null {
      db.prepare(
        `UPDATE npcs SET name = ?, role = ?, emoji = ?, color = ?, brain = ?, instructions = ?,
          tools_json = ?, enabled = ?, template_id = ?, updated_at = ? WHERE id = ?`,
      ).run(
        input.name,
        input.role,
        input.emoji,
        input.color,
        input.brain,
        input.instructions,
        JSON.stringify(input.tools),
        input.enabled ? 1 : 0,
        input.templateId,
        nowIso(),
        id,
      );
      const r = row(id);
      return r ? toNpc(r) : null;
    },

    setEnabled(id: string, enabled: boolean): void {
      db.prepare('UPDATE npcs SET enabled = ?, updated_at = ? WHERE id = ?').run(
        enabled ? 1 : 0,
        nowIso(),
        id,
      );
    },

    /** Removes the NPC and its private chat; its words in the office and meetings stay. */
    delete(id: string): void {
      db.prepare('DELETE FROM npc_messages WHERE channel = ?').run(`dm:${id}`);
      db.prepare('DELETE FROM npcs WHERE id = ?').run(id);
    },

    addMessage(m: Omit<NpcMessage, 'id' | 'createdAt'>): NpcMessage {
      const msg: NpcMessage = { ...m, id: newId('nm_'), createdAt: nowIso() };
      db.prepare(
        'INSERT INTO npc_messages (id, channel, author, text, mentions_json, tainted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        msg.id,
        msg.channel,
        msg.author,
        msg.text,
        JSON.stringify(msg.mentions),
        msg.tainted ? 1 : 0,
        msg.createdAt,
      );
      return msg;
    },

    /** The latest `limit` messages of a channel, oldest first. */
    messages(channel: string, limit = 100): NpcMessage[] {
      const rows = db
        .prepare(
          'SELECT * FROM npc_messages WHERE channel = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
        )
        .all(channel, limit) as unknown as MessageRow[];
      return rows.reverse().map(toMessage);
    },

    clearChannel(channel: string): void {
      db.prepare('DELETE FROM npc_messages WHERE channel = ?').run(channel);
    },

    createMeeting(topic: string, attendees: string[]): NpcMeeting {
      const m: NpcMeeting = {
        id: newId('mtg_'),
        topic,
        attendees,
        status: 'running',
        summary: '',
        createdAt: nowIso(),
      };
      db.prepare(
        'INSERT INTO npc_meetings (id, topic, attendees_json, status, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(m.id, m.topic, JSON.stringify(m.attendees), m.status, m.summary, m.createdAt);
      return m;
    },

    finishMeeting(id: string, status: 'done' | 'stopped', summary: string): void {
      db.prepare('UPDATE npc_meetings SET status = ?, summary = ? WHERE id = ?').run(
        status,
        summary,
        id,
      );
    },

    stopStaleMeetings(): void {
      db.prepare("UPDATE npc_meetings SET status = 'stopped' WHERE status = 'running'").run();
    },

    meetings(limit = 30): NpcMeeting[] {
      return (
        db
          .prepare('SELECT * FROM npc_meetings ORDER BY created_at DESC LIMIT ?')
          .all(limit) as unknown as MeetingRow[]
      ).map(toMeeting);
    },
  };
}

export type NpcRepo = ReturnType<typeof createNpcRepo>;
