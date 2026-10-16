import { BrowserWindow, app, dialog, shell } from 'electron';
import { JarvisError } from '../../errors';
import type { MemorySystem } from '../../memory/memory-system';
import { normalizeRel } from '../../memory/vault-service';
import { stringifyNote } from '../../memory/frontmatter';
import { buildGraph } from '../../memory/graph';
import { importChats, parseExport, readExport } from '../../memory/chat-import';
import { nowIso } from '../../lib/util';
import type { Services } from '../../services';
import { handle } from '../handle';

function memoryRel(p: string): string {
  const rel = normalizeRel(p || 'Memory');
  if (rel !== 'Memory' && !rel.startsWith('Memory/'))
    throw new JarvisError(
      'INVALID',
      'not a memory path',
      'Only notes in the Memory folder can be opened here.',
    );
  return rel;
}

/** Writes onboarding quick facts into About Sir.md (App-flow.md §3 step 3). */
export async function writeQuickFacts(
  m: MemorySystem,
  facts: { role?: string | undefined; project?: string | undefined; city?: string | undefined },
): Promise<void> {
  const lines = [
    facts.role && `- Sir works as ${facts.role.trim()}.`,
    facts.project && `- Sir's main project is ${facts.project.trim()}.`,
    facts.city && `- Sir lives in ${facts.city.trim()}.`,
  ].filter(Boolean);
  if (lines.length === 0) return;
  const rel = 'Memory/About Sir.md';
  const current = m.vault.exists(rel) ? await m.vault.read(rel) : null;
  const body = `${(current?.body ?? '# About Sir\n').trimEnd()}\n${lines.join('\n')}\n`;
  await m.vault.write(
    rel,
    stringifyNote(
      { ...(current?.frontmatter ?? { kind: 'profile', title: 'About Sir' }), updated: nowIso() },
      body,
    ),
    current ? { expectedHash: current.hash } : {},
  );
}

export function registerMemoryHandlers(s: Services, m: MemorySystem): void {
  handle('memory:list', async (req) => m.vault.list(memoryRel(req.dir)));
  // Reading any note is fine (the Brain graph opens Spaces pages and logs too); the vault guard
  // still refuses paths that escape the vault.
  handle('memory:read', async (req) => {
    const rel = normalizeRel(req.vaultPath);
    if (!rel.toLowerCase().endsWith('.md'))
      throw new JarvisError('INVALID', 'not a note', 'Only Markdown notes can be opened here.');
    return { markdown: (await m.vault.read(rel)).raw };
  });
  handle('memory:graph', () => buildGraph(m.vault));
  handle('memory:search', (req) => m.retriever.searchMemories(req.query, 20));
  handle('memory:delete', async (req) => {
    const rel = memoryRel(req.vaultPath);
    if (rel === 'Memory')
      throw new JarvisError('INVALID', 'root', 'The Memory folder itself cannot be deleted.');
    const moved = await m.vault.trash(rel);
    s.audit.append('user', 'memory.delete', { vaultPath: rel, movedTo: moved });
    s.emit('memory:changed', { vaultPaths: [rel] });
    return { ok: true };
  });
  handle('memory:openInObsidian', async (req) => {
    const abs = m.vault.resolve(req.vaultPath ? normalizeRel(req.vaultPath) : '');
    if (app.getApplicationNameForProtocol('obsidian://'))
      await shell.openExternal(`obsidian://open?path=${encodeURIComponent(abs)}`);
    else await shell.openPath(abs);
    return { ok: true };
  });
  handle('memory:reviewList', () =>
    m.repos.review.pending().map((r) => ({
      id: r.id,
      op: r.op,
      targetPath: r.target_path,
      proposedMarkdown: r.proposed_markdown,
      reason: r.reason,
      createdAt: r.created_at,
    })),
  );
  handle('memory:reviewResolve', async (req) => {
    if (req.decision === 'accepted') await m.curator.acceptReview(req.id);
    m.repos.review.resolve(req.id, req.decision);
    s.audit.append('user', 'memory.review', { id: req.id, decision: req.decision });
    return { ok: true };
  });
  // ChatGPT / Claude.ai history (idea from LibreChat): Sir picks the export; each chat becomes a note.
  handle('memory:importChats', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: 'Import ChatGPT or Claude history',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'ChatGPT or Claude export', extensions: ['zip', 'json'] }],
    };
    const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = pick.canceled ? undefined : pick.filePaths[0];
    if (!file)
      return { cancelled: true, source: null, imported: 0, skipped: 0, failed: 0, total: 0 };
    const chats = parseExport(await readExport(file));
    s.emit('notify', { level: 'info', message: `Importing ${chats.length} chats into memory…` });
    const r = await importChats(chats, m.vault);
    s.audit.append('user', 'memory.importChats', { ...r, total: chats.length });
    s.emit('memory:changed', { vaultPaths: ['Memory/Imports'] });
    return { cancelled: false, ...r, total: chats.length };
  });
  handle('memory:rebuildIndex', async () => ({ files: (await m.indexer?.rebuild()) ?? 0 }));
  handle('routines:list', () =>
    m.repos.routines.all().map((r) => ({
      name: r.name,
      triggers: JSON.parse(r.trigger_phrases_json) as string[],
      enabled: r.enabled === 1,
      ...(r.error ? { error: r.error } : {}),
    })),
  );
}
