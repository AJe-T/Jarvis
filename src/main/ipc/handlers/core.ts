import { app, dialog, shell, BrowserWindow } from 'electron';
import { SENSITIVE_SETTINGS } from '@shared/settings';
import { JarvisError } from '../../errors';
import { localDay } from '../../lib/util';
import { toSummary } from '../../db/repos/conversations-repo';
import { toUiToolCall } from '../../db/repos/tool-calls-repo';
import { buildUiMessages } from '../../agent/ui-history';
import { claudeCodeStatus, openClaudeLogin } from '../../llm/claude-code';
import { monthStart } from '../../llm/usage-ledger';
import { detectTownFromIp } from '../../tools/everyday/weather';
import { pickModel } from '../../agent/model-router';
import type { Services } from '../../services';
import { isSafeExternalUrl } from '../../windows/hardening';
import { handle } from '../handle';

/** Phase 1 channels: chat, conversations, settings, secrets, usage, app. */
export interface CoreHooks {
  audit?: (event: string, details: Record<string, unknown>) => void;
  /** Phase 3: create the vault skeleton and write quick facts to About Sir.md. */
  onOnboarded?: (
    vaultPath: string,
    facts: { role?: string | undefined; project?: string | undefined; city?: string | undefined },
  ) => Promise<void>;
}

export function registerCoreHandlers(s: Services, hooks: CoreHooks = {}): void {
  const audit = hooks.audit ?? (() => undefined);

  handle('onboarding:complete', async (req) => {
    s.settings.set('vault.path', req.vaultPath);
    s.settings.set('voice.mode', req.voiceMode);
    await hooks.onOnboarded?.(req.vaultPath, req.facts);
    s.settings.set('onboarding.complete', true);
    audit('settings.change', { key: 'onboarding.complete' });
    return { ok: true };
  });

  handle('chat:send', (req) => s.orchestrator.send(req));
  handle('chat:cancel', (req) => {
    s.orchestrator.cancel(req.turnId);
    return { ok: true };
  });

  handle('conversations:list', (req) => {
    const rows = s.conversations.list(req.limit + 1, req.cursor);
    const items = rows.slice(0, req.limit).map(toSummary);
    const last = items.at(-1);
    return { items, ...(rows.length > req.limit && last ? { nextCursor: last.lastActiveAt } : {}) };
  });
  handle('conversations:get', (req) => {
    const conv = s.conversations.get(req.id);
    if (!conv)
      throw new JarvisError(
        'NOT_FOUND',
        'conversation not found',
        'That conversation no longer exists.',
      );
    const rows = s.conversations.messages(req.id);
    const useIds = rows.flatMap((r) =>
      r.role === 'assistant'
        ? [...r.content_json.matchAll(/"id":"(toolu_[^"]+)"/g)].map((m) => m[1] as string)
        : [],
    );
    const calls = new Map(
      s.toolCalls.byToolUseIds(useIds).map((t) => [t.tool_use_id, toUiToolCall(t)]),
    );
    return { conversation: toSummary(conv), messages: buildUiMessages(rows, calls) };
  });
  handle('conversations:delete', (req) => {
    s.conversations.delete(req.id);
    audit('conversation.delete', { id: req.id, alsoVault: req.alsoVault });
    return { ok: true };
  });

  handle('settings:getAll', () => s.settings.all());
  handle('settings:set', (req) => {
    // Sensitive settings are only changed from the Settings UI after its own confirmation dialog.
    s.settings.set(req.key, req.value);
    audit('settings.change', {
      key: req.key,
      ...(SENSITIVE_SETTINGS.includes(req.key) ? { value: req.value } : {}),
    });
    return { ok: true };
  });

  handle('secrets:set', (req) => {
    const { last4 } = s.secrets.set(req.name, req.value);
    audit('secret.change', { name: req.name, action: 'set' });
    return { ok: true, last4 };
  });
  handle('secrets:delete', (req) => {
    s.secrets.delete(req.name);
    audit('secret.change', { name: req.name, action: 'delete' });
    return { ok: true };
  });
  handle('secrets:status', () => s.secrets.status());
  handle('secrets:test', async (req) => {
    if (req.name !== 'anthropic') return { ok: s.secrets.get(req.name) !== undefined };
    try {
      await s.llmApi.ping(pickModel(s.settings, { purpose: 'title' }), AbortSignal.timeout(20_000));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof JarvisError && err.userMessage ? err.userMessage : 'The test call failed.',
      };
    }
  });

  handle('usage:summary', (req) => {
    const t = s.ledger.totals();
    const day = localDay();
    const from = req.range === 'day' ? day : monthStart(day);
    const all = s.usageRepo.totals(from, day);
    return {
      costUsd: s.usageRepo.totals(from, day, 'api').costUsd,
      subscriptionCostUsd: s.usageRepo.totals(from, day, 'subscription').costUsd,
      tokens: all.tokens,
      budget:
        req.range === 'day'
          ? s.settings.get('budget.dailyUsd')
          : s.settings.get('budget.monthlyUsd'),
      dayCostUsd: t.day,
      monthCostUsd: t.month,
    };
  });
  const userError = (err: unknown): string =>
    err instanceof JarvisError && err.userMessage ? err.userMessage : String(err);
  handle('llm:localModels', async () => {
    try {
      return { models: await s.llmLocal.listModels() };
    } catch (err) {
      return { models: [], error: userError(err) };
    }
  });
  handle('llm:localTest', async () => {
    try {
      await s.llmLocal.ping('', AbortSignal.timeout(10_000));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: userError(err) };
    }
  });
  handle('llm:claudeCodeStatus', () => claudeCodeStatus(s.claudeCode.path()));
  handle('llm:claudeCodeLogin', () => {
    const path = s.claudeCode.path();
    if (!path)
      throw new JarvisError(
        'NOT_FOUND',
        'claude.exe not found',
        'Claude Code is not installed on this PC.',
      );
    openClaudeLogin(path);
    audit('llm.claudeCodeLogin', {});
    return { ok: true };
  });
  // Opt-in only (a button in Settings): one request that reveals the public IP to ipapi.co.
  handle('location:detect', async () => {
    audit('location.detect', {});
    return { town: await detectTownFromIp() };
  });
  handle('usage:breakdown', (req) => {
    const day = localDay();
    return s.usageRepo.breakdown(req.range === 'day' ? day : monthStart(day), day, req.by);
  });

  handle('activity:list', (req) =>
    s.toolCalls
      .list(req.limit, req.conversationId)
      .map((r) => ({ ...toUiToolCall(r), conversationId: r.conversation_id })),
  );

  handle('app:info', () => ({
    version: app.getVersion(),
    userData: s.userData,
    vaultPath: s.settings.get('vault.path'),
    isTest: s.isTest,
    online: true,
    dbHealthy: s.dbHealthy,
  }));
  handle('app:openExternal', async (req) => {
    if (!isSafeExternalUrl(req.url))
      throw new JarvisError('INVALID', 'unsafe url', 'Only web links can be opened.');
    await shell.openExternal(req.url);
    return { ok: true };
  });
  handle('app:killSwitch', () => {
    s.killSwitch.trigger('ui');
    return { ok: true };
  });
  handle('app:pickFolder', async (req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: req.title,
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return { path: r.canceled ? null : (r.filePaths[0] ?? null) };
  });
}
