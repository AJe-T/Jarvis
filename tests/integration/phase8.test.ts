import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localDay } from '@main/lib/util';
import { fakeClaudeCode, result, text, toolResults, toolUse } from './fake-claude-code';
import { idle, setupServices } from './helpers';

describe('Claude subscription mode end to end (ADR-010)', () => {
  it('a chat turn runs a confirmed Jarvis tool through Claude Code; usage is recorded but not budgeted', async () => {
    let folder = '';
    const query = fakeClaudeCode(
      async function* (io) {
        yield text('m1', 'Creating it, sir.');
        yield toolUse('m1', 'toolu_1', 'mcp__jarvis__create_folder', { path: folder });
        const r = await io.callTool('create_folder', { path: folder }, 'toolu_1');
        yield toolResults({ id: 'toolu_1', content: r.content, isError: r.isError ?? false });
        yield text('m2', 'Done.');
        yield result();
      },
      // Background calls after the turn (conversation title).
      async function* () {
        yield text('t1', 'Invoices folder');
        yield result();
      },
    );
    const t = setupServices(undefined, {
      claudeCodeQuery: query,
      claudeCodePath: () => 'C:/fake/claude.exe',
    });
    const s = t.services;
    folder = join(t.dir, 'home', 'Desktop', 'Invoices');
    s.settings.set('llm.provider', 'subscription');
    s.settings.set('budget.dailyUsd', 0); // would block every API call
    const confirms: string[] = [];
    s.confirmShowListeners.add((e) => {
      confirms.push(e.title);
      s.broker.respond(e.requestId, 'approve', 'click');
    });

    const { conversationId } = s.orchestrator.send({
      text: 'make an Invoices folder on my desktop',
      source: 'text',
    });
    await idle(s, 10_000);

    expect(confirms).toEqual(['Create folder "Invoices"?']);
    expect(existsSync(folder)).toBe(true);
    const row = s.toolCalls.byToolUseIds(['toolu_1'])[0];
    expect(row).toMatchObject({ tool_name: 'create_folder', status: 'success' });
    const stored = s.conversations.messages(conversationId).map((m) => m.text_plain);
    expect(stored).toEqual(expect.arrayContaining(['Creating it, sir.', 'Done.']));
    expect(t.llm.calls).toHaveLength(0); // the API client was never used

    const day = localDay();
    expect(s.usageRepo.totals(day, day, 'subscription').tokens).toBeGreaterThan(0);
    expect(s.usageRepo.totals(day, day, 'api').costUsd).toBe(0);
    expect(s.budget.isExceeded()).toBe(false);
    s.settings.set('llm.provider', 'api');
    expect(s.budget.isExceeded()).toBe(true);
  });

  it('switching back to the API key uses the Messages API again', async () => {
    const query = fakeClaudeCode(async function* () {
      yield result();
    });
    const t = setupServices(
      { rules: [{ match: 'hello', steps: [{ text: 'Hello from the API.' }] }] },
      { claudeCodeQuery: query, claudeCodePath: () => 'C:/fake/claude.exe' },
    );
    t.services.orchestrator.send({ text: 'hello', source: 'text' });
    await idle(t.services);
    expect(query.calls).toHaveLength(0);
    expect(t.llm.calls.length).toBeGreaterThan(0);
  });
});
