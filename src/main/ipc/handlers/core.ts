import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, shell, BrowserWindow } from 'electron';
import { MAIN_ONLY_SETTINGS, SENSITIVE_SETTINGS } from '@shared/settings';
import { JarvisError } from '../../errors';
import { createSystemSampler } from '../../lib/system-stats';
import { localDay } from '../../lib/util';
import { toSummary } from '../../db/repos/conversations-repo';
import { toUiToolCall } from '../../db/repos/tool-calls-repo';
import { buildUiMessages } from '../../agent/ui-history';
import { detectAgentClis } from '../../llm/agent-clis';
import { claudeCodeStatus, openClaudeLogin } from '../../llm/claude-code';
import { cliEnv } from '../../llm/cli-brains';
import { monthStart } from '../../llm/usage-ledger';
import { detectTownFromIp } from '../../tools/everyday/weather';
import { pickModel } from '../../agent/model-router';
import type { Services } from '../../services';
import { isSafeExternalUrl } from '../../windows/hardening';
import { handle } from '../handle';
import { CLOUD_PROVIDERS, defaultConnectionId } from '@shared/llm-providers';

/** Usage grouped by who answered: local apart from the cloud (integrations step 5). */
const SOURCE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic API key',
  'claude-plan': 'Claude plan (subscription)',
  local: 'This PC (local model, free)',
  cloud: 'Another AI (connection not recorded)',
  earlier: 'Earlier (before 2.27, not recorded)',
};
const BILLING_LABELS: Record<string, string> = {
  api: 'Billed per use (API keys)',
  subscription: 'Your Claude plan (not billed per use)',
  local: 'This PC (free)',
};

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

  handle('chat:rewind', (req) => {
    if (s.orchestrator.isBusy())
      throw new JarvisError('INVALID', 'busy', 'Let Jarvis finish (or stop him) before rewinding.');
    const text = s.conversations.rewind(req.conversationId, req.userIndex);
    if (text === null)
      throw new JarvisError('INVALID', 'no such message', 'That message is no longer there.');
    s.audit.append('user', 'chat.rewind', {
      conversationId: req.conversationId,
      userIndex: req.userIndex,
    });
    if (!req.resend) return { text };
    const { turnId } = s.orchestrator.send({
      conversationId: req.conversationId,
      text,
      source: 'text',
    });
    return { text, turnId };
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
  handle('conversations:search', (req) => s.conversations.searchChats(req.query));
  handle('conversations:context', (req) => s.orchestrator.contextStats(req.id));
  handle('conversations:compact', async (req) => {
    const r = await s.orchestrator.compact(req.id);
    audit('conversation.compact', { id: req.id, messages: r.summarizedMessages });
    return r;
  });
  handle('conversations:delete', (req) => {
    s.conversations.delete(req.id);
    audit('conversation.delete', { id: req.id, alsoVault: req.alsoVault });
    return { ok: true };
  });

  handle('settings:getAll', () => s.settings.all());
  handle('settings:set', (req) => {
    if (MAIN_ONLY_SETTINGS.includes(req.key))
      throw new JarvisError(
        'IPC_FORBIDDEN',
        `${req.key} is main-only`,
        'That setting can only be changed by pairing.',
      );
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
      plan: s.planLimits.get(),
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
  handle('llm:cloudModels', async () => {
    try {
      return { models: (await s.llmCloud.listModels()).sort() };
    } catch (err) {
      return { models: [], error: userError(err) };
    }
  });
  handle('llm:cloudTest', async () => {
    try {
      await s.llmCloud.ping('', AbortSignal.timeout(10_000));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: userError(err) };
    }
  });
  handle('llm:cliStatus', async () =>
    Promise.all(
      (['chatgpt', 'antigravity'] as const).map(async (id) => {
        const b = s.brains.cli(id);
        const installed = b?.find() != null;
        return {
          id,
          label: b?.label ?? id,
          installed,
          signedIn: installed && b ? await b.signedIn() : false,
          installHint: b?.installHint ?? '',
        };
      }),
    ),
  );
  handle('llm:agentClis', () =>
    detectAgentClis({
      known: {
        claude: s.claudeCode.path(),
        codex: s.brains.cli('chatgpt')?.find() ?? null,
        antigravity: s.brains.cli('antigravity')?.find() ?? null,
      },
    }),
  );
  handle('llm:cliLogin', (req) => {
    const b = s.brains.cli(req.id);
    const exe = b?.find();
    if (!b || !exe)
      throw new JarvisError('NOT_FOUND', 'cli missing', `${b?.label ?? req.id} is not installed.`);
    // The app's own sign-in, in its own console window (browser opens from there). No shell.
    spawn(exe, b.loginArgs, {
      env: cliEnv(),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    }).unref();
    s.audit.append('user', 'llm.cliLogin', { id: req.id });
    return { ok: true };
  });
  handle('llm:cliTest', async (req) => {
    const b = s.brains.cli(req.id);
    if (!b) return { ok: false, error: 'Unknown app.' };
    try {
      await b.run('Reply with exactly: OK', AbortSignal.timeout(120_000));
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
  const sampleSystem = createSystemSampler();
  handle('system:stats', () => sampleSystem());
  handle('usage:breakdown', (req) => {
    const day = localDay();
    const rows = s.usageRepo.breakdown(req.range === 'day' ? day : monthStart(day), day, req.by);
    const extra = s.connections.extraLabels();
    const label = (key: string): string => {
      if (req.by === 'billing') return BILLING_LABELS[key] ?? key;
      if (req.by !== 'source') return key;
      if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
      const provider = CLOUD_PROVIDERS.find((p) => defaultConnectionId(p.id) === key);
      return provider ? provider.label : (extra[key] ?? key);
    };
    return rows.map((r) => ({ ...r, key: String(r.key), label: label(String(r.key)) }));
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
  handle('app:relaunch', () => {
    s.audit.append('user', 'app.relaunch', {});
    // Let the reply reach the renderer, then restart through the normal quit path (before-quit cleanup).
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 200);
    return { ok: true };
  });
  handle('app:killSwitch', () => {
    s.killSwitch.trigger('ui');
    return { ok: true };
  });
  // Chat artifacts: written only where Sir chooses in the Save dialog.
  handle('artifacts:save', async (req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const name =
      req.title
        .replace(/[\\/:*?"<>|.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Artifact';
    const opts = {
      title: 'Save artifact',
      defaultPath: join(app.getPath('documents'), `${name}.${req.ext}`),
      filters: [
        req.ext === 'html'
          ? { name: 'Web page', extensions: ['html'] }
          : { name: 'SVG drawing', extensions: ['svg'] },
      ],
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { path: null };
    await writeFile(r.filePath, req.content, 'utf8');
    audit('artifact.save', { ext: req.ext });
    return { path: r.filePath };
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
