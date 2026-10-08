import { request } from 'node:https';
import { describe, expect, it } from 'vitest';
import { createPhoneRemote } from '@main/channels/phone-remote';
import { idle, setupServices } from './helpers';

function call(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        rejectUnauthorized: false, // self-signed certificate made by Windows for this test
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('phone remote', () => {
  it('serves the page, pairs with a one-time code, and runs turns for paired phones only', async () => {
    const t = setupServices({
      rules: [{ match: 'hello', steps: [{ text: 'Hello from the PC, sir.' }] }],
    });
    const s = t.services;
    const port = 20000 + Math.floor(Math.random() * 20000);
    s.settings.set('remote.port', port);
    s.settings.set('remote.enabled', true);
    const remote = createPhoneRemote(s);
    await remote.start();
    expect(remote.status()).toMatchObject({ running: true, error: null });
    try {
      const page = await call(port, 'GET', '/');
      expect(page.status).toBe(200);
      expect(page.text).toContain('<title>Jarvis</title>');

      expect((await call(port, 'POST', '/api/chat', { text: 'hello' })).status).toBe(401);
      expect((await call(port, 'POST', '/api/pair', { code: '123456' })).status).toBe(403);

      const code = remote.newPairingCode().pairingCode ?? '';
      const paired = await call(port, 'POST', '/api/pair', { code, name: 'Android' });
      const { token } = JSON.parse(paired.text) as { token: string };
      expect(token.length).toBeGreaterThan(30);
      // The code works once.
      expect((await call(port, 'POST', '/api/pair', { code })).status).toBe(403);
      expect(remote.status().devices).toHaveLength(1);
      expect(s.secrets.get('remote_devices')).not.toContain(token);

      const sent = await call(port, 'POST', '/api/chat', { text: 'hello' }, token);
      expect(sent.status).toBe(200);
      await idle(s);
      expect(s.conversations.list(5)).toHaveLength(1);

      remote.revoke(remote.status().devices[0]?.id ?? '');
      expect((await call(port, 'POST', '/api/chat', { text: 'hello' }, token)).status).toBe(401);
    } finally {
      remote.stop();
    }
  }, 60_000);
});
