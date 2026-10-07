import { describe, expect, it } from 'vitest';
import { chunkMessage, createTelegramChannel } from '@main/channels/telegram';
import { idle, setupServices } from './helpers';

const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** A fake Bot API: queued updates for getUpdates, every other call recorded. */
function fakeTelegram() {
  const queue: unknown[] = [];
  const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
  let id = 1;
  const fetch = (async (url: string, init?: RequestInit) => {
    const method = url.split('/').at(-1) ?? '';
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    if (method === 'getMe')
      return Response.json({ ok: true, result: { username: 'jarvis_test_bot' } });
    if (method === 'getUpdates') {
      await new Promise((r) => setTimeout(r, 20));
      const batch = queue.splice(0).map((u) => ({ update_id: id++, ...(u as object) }));
      return Response.json({ ok: true, result: batch });
    }
    sent.push({ method, body });
    return Response.json({ ok: true, result: {} });
  }) as typeof globalThis.fetch;
  const msg = (chat: number, text: string) => ({
    message: { message_id: 1, chat: { id: chat, type: 'private' }, text },
  });
  const tap = (chat: number, data: string) => ({
    callback_query: { id: 'cb', data, message: { chat: { id: chat }, message_id: 2 } },
  });
  return { fetch, queue, sent, msg, tap };
}

describe('Telegram channel (ideas from OpenJarvis)', () => {
  it('splits long replies under the 4096 limit', () => {
    const parts = chunkMessage(`${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`);
    expect(parts.map((p) => p.length)).toEqual([3000, 3000]);
  });

  it('pairs with the code, answers only that chat, and turns messages into normal turns', async () => {
    const tg = fakeTelegram();
    const t = setupServices({
      rules: [{ match: 'time', steps: [{ text: '<spoken>Half past nine, sir.</spoken>' }] }],
    });
    const s = t.services;
    s.secrets.set('telegram', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ');
    s.settings.set('telegram.enabled', true);
    const ch = createTelegramChannel(s, { fetch: tg.fetch, pollTimeoutSec: 0 });
    await ch.start();
    const code = ch.status().pairingCode ?? '';
    expect(code).toMatch(/^\d{6}$/);

    tg.queue.push(tg.msg(42, 'hello'), tg.msg(42, code)); // wrong text ignored, then the code pairs
    await until(() => ch.status().paired);
    expect(s.settings.get('telegram.chatId')).toBe('42');

    tg.queue.push(tg.msg(666, 'what time is it'), tg.msg(42, 'what time is it'));
    await until(() =>
      tg.sent.some((x) => x.method === 'sendMessage' && x.body['text'] === 'Half past nine, sir.'),
    );
    await idle(s);
    expect(tg.sent.filter((x) => x.body['chat_id'] === 666)).toEqual([]);
    expect(s.audit.all().some((a) => a.event === 'telegram.rejected')).toBe(true);
    ch.stop();
  });

  it('sends confirmations as buttons; destructive ones can only be denied from the phone', async () => {
    const tg = fakeTelegram();
    const t = setupServices({
      rules: [
        {
          match: 'clipboard',
          steps: [{ tools: [{ name: 'read_clipboard', input: {} }] }, { text: 'Done.' }],
        },
      ],
    });
    const s = t.services;
    s.secrets.set('telegram', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ');
    s.settings.set('telegram.enabled', true);
    const ch = createTelegramChannel(s, { fetch: tg.fetch, pollTimeoutSec: 0 });
    await ch.start();
    tg.queue.push(tg.msg(7, ch.status().pairingCode ?? ''));
    await until(() => ch.status().paired);

    tg.queue.push(tg.msg(7, 'read my clipboard'));
    await until(() => tg.sent.some((x) => x.body['reply_markup'] !== undefined));
    const prompt = tg.sent.find((x) => x.body['reply_markup'] !== undefined);
    const buttons =
      (prompt?.body['reply_markup'] as { inline_keyboard: Array<Array<{ callback_data: string }>> })
        .inline_keyboard[0] ?? [];
    expect(buttons).toHaveLength(2); // non-destructive: Approve + Deny
    tg.queue.push(tg.tap(7, buttons[0]?.callback_data ?? ''));
    await idle(s, 5000);
    const row = s.toolCalls.list(5).find((r) => r.tool_name === 'read_clipboard');
    expect(row?.decided_by).toBe('user_remote');
    expect(row?.status).toBe('success');
    ch.stop();
  });

  it('the broker never lets a phone approve a destructive action', async () => {
    const t = setupServices();
    const shown: string[] = [];
    t.services.confirmShowListeners.add((e) => shown.push(e.requestId));
    const pending = t.services.broker.request(
      {
        toolName: 'delete_to_recycle_bin',
        title: 'Delete?',
        humanSummary: 'Delete files',
        details: 'x',
        detailsKind: 'text',
        actionLabel: 'Delete',
        destructive: true,
      },
      new AbortController().signal,
    );
    await until(() => shown.length === 1);
    expect(t.services.broker.respond(shown[0] ?? '', 'approve', 'remote')).toBe(false);
    expect(t.services.broker.respond(shown[0] ?? '', 'deny', 'remote')).toBe(true);
    expect((await pending).decision).toBe('deny');
  });
});
