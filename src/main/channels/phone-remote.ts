import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { TurnEnd } from '../agent/orchestrator';
import { errorMessage } from '../errors';
import { logger } from '../logging/logger';
import type { Services } from '../services';
import { runPowerShell } from '../tools/powershell';
import type { ConfirmRequestEvent } from '../tools/confirmation-broker';
import { phonePage } from './phone-page';

/**
 * Phone remote (PRD F20): Jarvis serves a small web app over HTTPS on the home network so Sir can
 * type, dictate or hold a hands-free "call" from his phone's browser. Free: the phone's own speech
 * recogniser and voice do the audio. Same rules as Telegram: one turn at a time through the normal
 * orchestrator and policy engine; non-destructive confirmations can be approved on the phone,
 * destructive ones only at the PC. Devices pair with a 6-digit code (or QR) shown in Settings and
 * get a random token; only its hash is kept (encrypted with the other secrets).
 */

const PAIR_TTL_MS = 10 * 60_000;
const MAX_BODY = 64 * 1024;
const CONVERSATION_GAP_MS = 12 * 3_600_000;

export interface RemoteDevice {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeen: string | null;
}

export interface RemoteStatus {
  running: boolean;
  urls: string[];
  port: number;
  pairingCode: string | null;
  pairingUrl: string | null;
  devices: Array<{ id: string; name: string; createdAt: string; lastSeen: string | null }>;
  error: string | null;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Home-network IPv4 addresses, real Wi-Fi/Ethernet first (virtual WSL/Hyper-V/VM adapters last). */
export function lanAddresses(): string[] {
  const virtual =
    /vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|loopback|tailscale|zerotier/i;
  const out: Array<{ address: string; rank: number }> = [];
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const rank = (virtual.test(name) ? 2 : 0) + (a.address.startsWith('192.168.') ? 0 : 1);
      out.push({ address: a.address, rank });
    }
  return out.sort((x, y) => x.rank - y.rank).map((x) => x.address);
}

/** Self-signed certificate made by Windows (New-SelfSignedCertificate), exported to a PFX. */
const PS_MAKE_CERT = `
# @() keeps a single address a list; otherwise + glues the names into one string.
$names = @(@($P.ips | ForEach-Object { "IPAddress=$_" }) + @("DNS=$($P.host)", 'DNS=localhost'))
$ext = '2.5.29.17={text}' + ($names -join '&')
$cert = New-SelfSignedCertificate -Subject 'CN=Jarvis Phone Remote' -TextExtension @($ext) -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(3) -FriendlyName 'Jarvis phone remote'
$pw = ConvertTo-SecureString -String ([string]$P.pass) -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath ([string]$P.file) -Password $pw | Out-Null
Remove-Item -Path ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint) -Force
'ok'`;

/** Tiny per-address rate limiter: n requests per window. */
function limiter(n: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    return list.length <= n;
  };
}

const ChatBody = z.object({ text: z.string().trim().min(1).max(8000) });
const PairBody = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().max(100).default('Phone'),
});
const ConfirmBody = z.object({
  requestId: z.string().max(64),
  decision: z.enum(['approve', 'deny']),
});

export function createPhoneRemote(s: Services, deps: { certDir?: string } = {}) {
  const log = logger.child({ module: 'phone-remote' });
  const dir = deps.certDir ?? join(s.userData, 'remote');
  let server: Server | null = null;
  let lastError: string | null = null;
  /** One-time code; burned after 5 wrong guesses from anywhere (no per-address loophole). */
  let pairing: { code: string; until: number; misses: number } | null = null;
  const streams = new Map<string, Set<ServerResponse>>(); // device id → open event streams
  const turns = new Map<string, string>(); // turn id → device id
  let conversation: { id: string; at: number } | null = null;
  const statusListeners = new Set<() => void>();
  const changed = (): void => statusListeners.forEach((l) => l());
  const general = limiter(120, 60_000);
  const pairLimit = limiter(8, 10 * 60_000);

  const port = (): number => s.settings.get('remote.port');

  function devices(): RemoteDevice[] {
    try {
      return JSON.parse(s.secrets.get('remote_devices') ?? '[]') as RemoteDevice[];
    } catch {
      return [];
    }
  }
  function saveDevices(list: RemoteDevice[]): void {
    s.secrets.set('remote_devices', JSON.stringify(list));
  }

  function authenticate(token: string | null): RemoteDevice | null {
    if (!token || token.length < 20) return null;
    const h = Buffer.from(sha(token));
    const found = devices().find((d) => {
      const other = Buffer.from(d.tokenHash);
      return other.length === h.length && timingSafeEqual(other, h);
    });
    if (found) {
      found.lastSeen = new Date().toISOString();
      saveDevices(devices().map((d) => (d.id === found.id ? found : d)));
    }
    return found ?? null;
  }

  function push(deviceId: string, event: string, data: unknown): void {
    for (const res of streams.get(deviceId) ?? [])
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  async function ensureCert(): Promise<{ pfx: Buffer; passphrase: string }> {
    const file = join(dir, 'cert.pfx');
    let pass = s.secrets.get('remote_cert');
    if (!existsSync(file) || !pass) {
      mkdirSync(dir, { recursive: true });
      pass = randomBytes(24).toString('hex');
      const r = await runPowerShell(PS_MAKE_CERT, {
        params: { ips: lanAddresses(), host: hostname(), pass, file },
        timeoutMs: 60_000,
      });
      if (r.exitCode !== 0 || !existsSync(file))
        throw new Error(`Could not create the HTTPS certificate: ${r.stderr.slice(0, 200)}`);
      s.secrets.set('remote_cert', pass);
    }
    return { pfx: readFileSync(file), passphrase: pass };
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new Error('too large');
      chunks.push(c as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = req.socket.remoteAddress ?? '?';
    if (!general(ip)) return json(res, 429, { error: 'Too many requests. Slow down.' });
    const url = new URL(req.url ?? '/', 'https://jarvis.local');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'microphone=(self)',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.end(phonePage(nonce));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pair') {
      if (!pairLimit(ip)) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      const body = PairBody.safeParse(await readBody(req).catch(() => null));
      if (!body.success) return json(res, 400, { error: 'Enter the 6-digit code.' });
      const right =
        pairing !== null &&
        Date.now() <= pairing.until &&
        timingSafeEqual(Buffer.from(body.data.code), Buffer.from(pairing.code));
      if (!right) {
        if (pairing && ++pairing.misses >= 5) {
          pairing = null;
          changed();
        }
        return json(res, 403, {
          error: 'That code is wrong or expired. Show a new one in Settings → Phone.',
        });
      }
      pairing = null;
      const token = randomBytes(32).toString('base64url');
      const ua = body.data.name;
      const name = /iPhone|iPad/.test(ua)
        ? 'iPhone'
        : /Android/.test(ua)
          ? 'Android phone'
          : 'Browser';
      saveDevices([
        ...devices(),
        {
          id: randomBytes(6).toString('hex'),
          name,
          tokenHash: sha(token),
          createdAt: new Date().toISOString(),
          lastSeen: null,
        },
      ]);
      s.audit.append('user', 'remote.paired', { name });
      changed();
      return json(res, 200, { token });
    }

    // Everything below needs a paired device. EventSource can't send headers, so events take ?token=.
    const bearer =
      /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? url.searchParams.get('token');
    const device = authenticate(bearer);
    if (!device) return json(res, 401, { error: 'Not paired.' });

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const set = streams.get(device.id) ?? new Set();
      set.add(res);
      streams.set(device.id, set);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        set.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = ChatBody.safeParse(await readBody(req).catch(() => null));
      if (!body.success) return json(res, 400, { error: 'Type a message first.' });
      if (/^\/?stop( everything)?$/i.test(body.data.text)) {
        s.killSwitch.trigger('remote');
        return json(res, 200, { stopped: true });
      }
      const recent =
        conversation && Date.now() - conversation.at < CONVERSATION_GAP_MS
          ? conversation.id
          : undefined;
      const { conversationId, turnId } = s.orchestrator.send({
        text: body.data.text,
        source: 'text',
        ...(recent ? { conversationId: recent } : {}),
      });
      conversation = { id: conversationId, at: Date.now() };
      turns.set(turnId, device.id);
      return json(res, 200, { conversationId, turnId });
    }

    if (req.method === 'POST' && url.pathname === '/api/confirm') {
      const body = ConfirmBody.safeParse(await readBody(req).catch(() => null));
      if (!body.success) return json(res, 400, { error: 'Bad request.' });
      const okd = s.broker.respond(body.data.requestId, body.data.decision, 'remote');
      return json(
        res,
        okd ? 200 : 409,
        okd ? { ok: true } : { error: 'Expired, or it must be approved at the PC.' },
      );
    }

    json(res, 404, { error: 'Not found.' });
  }

  // Replies stream to the phone that asked; confirmations for its turns go there too.
  s.orchestrator.onDelta((turn, delta) => {
    const dev = turns.get(turn.turnId);
    if (dev) push(dev, 'delta', { turnId: turn.turnId, text: delta });
  });
  s.orchestrator.onTurnEnd((t: TurnEnd) => {
    const dev = turns.get(t.turnId);
    if (!dev) return;
    turns.delete(t.turnId);
    const spoken = [...t.replyText.matchAll(/<spoken>([\s\S]*?)<\/spoken>/g)]
      .map((m) => m[1])
      .join(' ');
    const text = t.replyText.replace(/<\/?spoken>/g, '').trim();
    push(dev, 'done', {
      turnId: t.turnId,
      text: t.outcome === 'error' ? 'Something went wrong on the PC, sir.' : text,
      spoken: spoken || text.slice(0, 400),
    });
  });
  s.confirmShowListeners.add((e: ConfirmRequestEvent) => {
    const turn = s.orchestrator.currentTurn();
    const dev = turn ? turns.get(turn.turnId) : undefined;
    if (!dev) return;
    push(dev, 'confirm', {
      requestId: e.requestId,
      title: e.title,
      details: e.details.slice(0, 1500),
      actionLabel: e.actionLabel,
      destructive: e.destructive,
    });
  });

  function urls(): string[] {
    return lanAddresses().map((a) => `https://${a}:${port()}`);
  }

  return {
    async start(): Promise<void> {
      if (server || !s.settings.get('remote.enabled')) return;
      try {
        const cert = await ensureCert();
        const srv = createServer({ ...cert, minVersion: 'TLSv1.2' }, (req, res) => {
          route(req, res).catch((err: unknown) => {
            log.warn({ err: errorMessage(err) }, 'phone remote request failed');
            if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the PC.' });
          });
        });
        await new Promise<void>((resolve, reject) => {
          srv.once('error', reject);
          srv.listen(port(), '0.0.0.0', () => resolve());
        });
        // Slow-loris protection: headers within 10 s, a request body within 30 s.
        srv.headersTimeout = 10_000;
        srv.requestTimeout = 30_000;
        srv.on('error', (err) => log.warn({ err: errorMessage(err) }, 'phone remote server error'));
        server = srv;
        lastError = null;
        log.info({ port: port() }, 'phone remote listening');
      } catch (err) {
        lastError = /EADDRINUSE/.test(errorMessage(err))
          ? `Port ${port()} is in use by another app. Pick another port.`
          : errorMessage(err);
        log.warn({ err: lastError }, 'phone remote failed to start');
      }
      changed();
    },
    stop(): void {
      for (const set of streams.values()) for (const res of set) res.end();
      streams.clear();
      server?.close();
      server = null;
      pairing = null;
      changed();
    },
    /** A fresh 6-digit code, valid for 10 minutes (shown with a QR code in Settings). */
    newPairingCode(): RemoteStatus {
      pairing = {
        code: String(randomInt(100000, 1000000)),
        until: Date.now() + PAIR_TTL_MS,
        misses: 0,
      };
      changed();
      return this.status();
    },
    revoke(id: string): void {
      saveDevices(devices().filter((d) => d.id !== id));
      for (const res of streams.get(id) ?? []) res.end();
      streams.delete(id);
      s.audit.append('user', 'remote.revoked', {});
      changed();
    },
    status(): RemoteStatus {
      const live = pairing && Date.now() < pairing.until ? pairing : null;
      const first = urls()[0] ?? null;
      return {
        running: server !== null,
        urls: urls(),
        port: port(),
        pairingCode: live?.code ?? null,
        pairingUrl: live && first ? `${first}/#pair=${live.code}` : null,
        devices: devices().map(({ id, name, createdAt, lastSeen }) => ({
          id,
          name,
          createdAt,
          lastSeen,
        })),
        error: lastError,
      };
    },
    onStatus(l: () => void): () => void {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
  };
}

export type PhoneRemote = ReturnType<typeof createPhoneRemote>;
