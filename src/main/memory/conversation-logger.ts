import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { sha256 } from '../lib/util';
import { parseNote, stringifyNote } from './frontmatter';
import type { VaultService } from './vault-service';

export interface LogEntry {
  conversationId: string;
  title: string | null;
  at: Date;
  source: 'text' | 'voice';
  userText: string;
  replyText: string;
  actions: string[];
  memoryUsed: string[];
}

const p2 = (n: number): string => String(n).padStart(2, '0');
const dayOf = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const blockId = (id: string): string => id.replace(/[^A-Za-z0-9-]/g, '-');

export function logPathFor(d: Date): string {
  return `Conversations/${d.getFullYear()}/${p2(d.getMonth() + 1)}/${dayOf(d)}.md`;
}

/** Database.md §8.3 daily log. Secrets are redacted by the vault service; private turns never reach here. */
export function createConversationLogger(vault: VaultService) {
  return {
    async append(e: LogEntry): Promise<string> {
      const rel = logPathFor(e.at);
      const abs = vault.resolve(rel);
      const existing = existsSync(abs) ? await readFile(abs, 'utf8') : '';
      const { frontmatter, body } = parseNote(existing);
      const ids = Array.isArray(frontmatter['conversations'])
        ? (frontmatter['conversations'] as string[])
        : [];
      const firstTime = !ids.includes(e.conversationId);
      const continuing =
        !firstTime && body.trimEnd().endsWith(`<!-- ${blockId(e.conversationId)} -->`);

      const lines: string[] = [];
      if (!continuing) {
        const heading =
          (e.title ?? e.userText.split(/\s+/).slice(0, 6).join(' '))
            .replace(/[\r\n#^]/g, ' ')
            .trim() || 'Conversation';
        lines.push(
          `## ${p2(e.at.getHours())}:${p2(e.at.getMinutes())} · ${heading}${firstTime ? `  ^${blockId(e.conversationId)}` : ''}`,
        );
      }
      lines.push(`**Sir${e.source === 'voice' ? ' (voice)' : ''}:** ${e.userText.trim()}`);
      lines.push(`**Jarvis:** ${e.replyText.replace(/<\/?spoken>/g, '').trim() || '_(no reply)_'}`);
      if (e.actions.length) lines.push(`> Actions: ${e.actions.join(' · ')}`);
      if (e.memoryUsed.length)
        lines.push(
          `> Memory used: ${e.memoryUsed.map((m) => `[[${m.replace(/^Memory\//, '').replace(/\.md$/, '')}]]`).join(', ')}`,
        );
      lines.push(`<!-- ${blockId(e.conversationId)} -->`);

      const fm = {
        date: dayOf(e.at),
        type: 'conversation-log',
        conversations: firstTime ? [...ids, e.conversationId] : ids,
      };
      const title = `# Conversations — ${e.at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
      const newBody = `${(body.trim() || title).trimEnd()}\n\n${lines.join('\n')}\n`;
      // We built the new content from the current file, so this is an edit, not a blind overwrite.
      await vault.write(rel, stringifyNote(fm, newBody), {
        expectedHash: existing ? sha256(existing) : undefined,
      });
      return rel;
    },
  };
}
