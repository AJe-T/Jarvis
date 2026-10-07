import { randomInt } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ToolError } from '../../errors';
import type { PathGuard } from '../../security/path-guard';
import type { OsAdapter } from '../native/os';
import { defineTool, fail, ok, type Tool } from '../types';

/**
 * Handy everyday plugins in the spirit of sukeesh/Jarvis: live currency and market prices, network
 * checks, a password generator and a folder tidier. Jokes, games, maths, unit conversion, BMI and
 * translation need no tool: Claude does them itself. All web APIs below are free and keyless
 * (checked 2026-10): Frankfurter (ECB rates), CoinGecko, Yahoo Finance chart, ipify, Cloudflare speed.
 */

const TIMEOUT = 15_000;
const SPEED_BYTES = 10_000_000;
const HOST = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/i, 'A host name or IP address, like example.com.');

interface StockMeta {
  symbol: string;
  longName?: string;
  fullExchangeName?: string;
  regularMarketPrice: number;
  currency?: string;
  regularMarketChangePercent?: number;
}

const CATEGORIES: Record<string, string[]> = {
  Images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'ico'],
  Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt', 'csv'],
  Audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  Video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
  Installers: ['exe', 'msi', 'msix'],
  Code: [
    'js',
    'ts',
    'py',
    'java',
    'c',
    'cpp',
    'cs',
    'go',
    'rs',
    'html',
    'css',
    'json',
    'xml',
    'ps1',
  ],
};
const CATEGORY_OF = new Map(
  Object.entries(CATEGORIES).flatMap(([cat, exts]) => exts.map((e) => [e, cat] as const)),
);

/** Which top-level files go where. Unknown types, hidden files and folders stay put. */
export function organizePlan(dir: string): Array<{ file: string; category: string }> {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .flatMap((e) => {
      const category = CATEGORY_OF.get(path.extname(e.name).slice(1).toLowerCase());
      return category ? [{ file: e.name, category }] : [];
    });
}

function freeName(dir: string, name: string): string {
  const { name: base, ext } = path.parse(name);
  let candidate = name;
  for (let i = 1; existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

/** Cryptographically random; a symbol and a digit guaranteed when allowed. */
export function makePassword(length: number, symbols: boolean): string {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
  if (symbols) sets.push('!@#$%^&*-_=+?');
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)] ?? '');
  while (chars.length < length) chars.push(all[randomInt(all.length)] ?? '');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] ?? '', chars[i] ?? ''];
  }
  return chars.join('');
}

export function createUtilityTools(deps: {
  os: OsAdapter;
  guard: PathGuard;
  fetch?: typeof fetch;
}): Tool[] {
  const f = deps.fetch ?? fetch;
  async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
    const res = await f(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS-desktop' },
    });
    if (!res.ok) throw new ToolError(`${new URL(url).host} answered ${res.status}.`);
    return (await res.json()) as T;
  }

  return [
    defineTool({
      name: 'convert_currency',
      description:
        "Convert money between currencies at today's European Central Bank rate (e.g. 100 USD to INR). Use ISO codes.",
      input: z.object({
        amount: z.number().positive().max(1e12),
        from: z.string().regex(/^[A-Za-z]{3}$/),
        to: z.string().regex(/^[A-Za-z]{3}$/),
      }),
      tier: 'SAFE',
      summarize: ({ amount, from, to }) =>
        `Convert ${amount} ${from.toUpperCase()} to ${to.toUpperCase()}`,
      async run({ amount, from, to }, ctx) {
        const [a, b] = [from.toUpperCase(), to.toUpperCase()];
        if (a === b) return ok(`${amount} ${a}.`);
        const r = await getJson<{ date: string; rates: Record<string, number> }>(
          `https://api.frankfurter.dev/v1/latest?base=${a}&symbols=${b}`,
          ctx.signal,
        ).catch(() => {
          throw new ToolError(`No rate for ${a} → ${b} (the ECB lists about 30 major currencies).`);
        });
        const rate = r.rates[b];
        if (!rate) return fail(`No rate for ${a} → ${b}.`);
        return ok(
          `${amount} ${a} = ${(amount * rate).toFixed(2)} ${b} (1 ${a} = ${rate} ${b}, ECB rate of ${r.date}).`,
        );
      },
    }),
    defineTool({
      name: 'get_market_price',
      description:
        "Latest price of a stock (Yahoo Finance symbol: AAPL, TSLA, RELIANCE.NS for NSE, TCS.BO for BSE) or a cryptocurrency (name or symbol: bitcoin, ETH) with the day's change.",
      input: z.object({
        kind: z.enum(['stock', 'crypto']),
        symbol: z.string().min(1).max(40),
        currency: z
          .string()
          .regex(/^[A-Za-z]{3}$/)
          .default('usd'),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      summarize: ({ kind, symbol }) => `Get the ${kind} price of ${symbol}`,
      async run({ kind, symbol, currency }, ctx) {
        if (kind === 'stock') {
          const r = await getJson<{
            chart: { result?: Array<{ meta: StockMeta }> | null };
          }>(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=1d&interval=1d`,
            ctx.signal,
          ).catch(() => {
            throw new ToolError(`No stock called ${symbol}. Indian shares need .NS or .BO.`);
          });
          const m = r.chart.result?.[0]?.meta;
          if (!m) return fail(`No stock called ${symbol}.`);
          const change = m.regularMarketChangePercent ?? 0;
          return ok(
            `${m.longName ?? m.symbol} (${m.symbol}, ${m.fullExchangeName ?? ''}): ${m.regularMarketPrice} ${m.currency ?? ''}, ${change >= 0 ? '+' : ''}${change.toFixed(2)}% today.`,
          );
        }
        const found = await getJson<{ coins: Array<{ id: string; name: string; symbol: string }> }>(
          `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`,
          ctx.signal,
        );
        const coin =
          found.coins.find((c) => c.symbol.toLowerCase() === symbol.toLowerCase()) ??
          found.coins[0];
        if (!coin) return fail(`No cryptocurrency called ${symbol}.`);
        const cur = currency.toLowerCase();
        const p = await getJson<Record<string, Record<string, number>>>(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=${cur}&include_24hr_change=true`,
          ctx.signal,
        );
        const price = p[coin.id]?.[cur];
        if (price === undefined) return fail(`No ${cur.toUpperCase()} price for ${coin.name}.`);
        const change = p[coin.id]?.[`${cur}_24h_change`] ?? 0;
        return ok(
          `${coin.name} (${coin.symbol}): ${price} ${cur.toUpperCase()}, ${change >= 0 ? '+' : ''}${change.toFixed(2)}% in 24 hours.`,
        );
      },
    }),
    defineTool({
      name: 'network_info',
      description:
        "Network checks: 'ips' (this PC's local and public IP addresses), 'dns' (look up a host's addresses), 'ping' (reachability and latency of a host), 'speed' (download speed test, ~10 MB).",
      input: z.object({ action: z.enum(['ips', 'dns', 'ping', 'speed']), host: HOST.optional() }),
      tier: 'SAFE',
      timeoutMs: 60_000,
      summarize: ({ action, host }) => `Network ${action}${host ? ` ${host}` : ''}`,
      async run({ action, host }, ctx) {
        if ((action === 'dns' || action === 'ping') && !host)
          return fail(`${action} needs a host.`);
        switch (action) {
          case 'ips': {
            const local = Object.entries(networkInterfaces()).flatMap(([name, addrs]) =>
              (addrs ?? [])
                .filter((a) => !a.internal && a.family === 'IPv4')
                .map((a) => `${name}: ${a.address}`),
            );
            const pub = await getJson<{ ip: string }>(
              'https://api.ipify.org?format=json',
              ctx.signal,
            )
              .then((r) => r.ip)
              .catch(() => 'unavailable (offline?)');
            return ok(`Local: ${local.join(', ') || 'none'}\nPublic: ${pub}`);
          }
          case 'dns': {
            const all = await dns.lookup(host ?? '', { all: true }).catch(() => {
              throw new ToolError(`${host} doesn't resolve.`);
            });
            return ok(`${host}: ${all.map((a) => a.address).join(', ')}`);
          }
          case 'ping': {
            const r = await deps.os.psJson<{ ok: number; avg: number | null }>(
              `$r = @(Test-Connection -ComputerName $P.host -Count 4 -ErrorAction SilentlyContinue)
$t = @($r | ForEach-Object { if ($null -ne $_.Latency) { $_.Latency } else { $_.ResponseTime } })
@{ ok = $r.Count; avg = if ($t.Count) { ($t | Measure-Object -Average).Average } else { $null } } | ConvertTo-Json -Compress`,
              { params: { host: host ?? '' }, timeoutMs: 30_000 },
            );
            return r.ok
              ? ok(`${host} answered ${r.ok}/4 pings, average ${Math.round(r.avg ?? 0)} ms.`)
              : ok(`${host} did not answer any of 4 pings.`);
          }
          case 'speed': {
            const start = Date.now();
            const res = await f(`https://speed.cloudflare.com/__down?bytes=${SPEED_BYTES}`, {
              signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(45_000)]),
            });
            if (!res.ok) throw new ToolError(`The speed test server answered ${res.status}.`);
            const bytes = (await res.arrayBuffer()).byteLength;
            const seconds = (Date.now() - start) / 1000;
            return ok(
              `Download: ${((bytes * 8) / seconds / 1e6).toFixed(1)} Mbps (${(bytes / 1e6).toFixed(0)} MB in ${seconds.toFixed(1)} s, Cloudflare).`,
            );
          }
        }
      },
    }),
    defineTool({
      name: 'generate_password',
      description:
        "Generate a strong random password and put it on sir's clipboard. The password itself is never shown to you or stored.",
      input: z.object({
        length: z.number().int().min(8).max(128).default(20),
        symbols: z.boolean().default(true),
      }),
      tier: 'SAFE',
      summarize: ({ length }) => `Generate a ${length}-character password to the clipboard`,
      async run({ length, symbols }) {
        await deps.os.clipboardWrite(makePassword(length, symbols));
        return ok(
          `A ${length}-character password is on the clipboard. Tell sir to paste it where he needs it.`,
        );
      },
    }),
    defineTool({
      name: 'organize_folder',
      description:
        'Tidy a folder (e.g. Downloads): move its loose files into Images, Documents, Audio, Video, Archives, Installers and Code subfolders. Unknown types and subfolders stay. Never overwrites. Requires confirmation.',
      input: z.object({ path: z.string().min(3).max(1024) }),
      tier: 'CONFIRM',
      summarize: ({ path: p }) => `Organise ${path.basename(p) || p} into subfolders by type`,
      guards: ({ path: p }) => ({ paths: [p] }),
      confirm: ({ path: p }) => {
        let details = p;
        try {
          const counts = new Map<string, number>();
          for (const m of organizePlan(deps.guard.resolve(p)))
            counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
          details = [...counts].map(([c, n]) => `${n} → ${c}`).join('\n') || 'Nothing to move.';
        } catch {
          // the policy and run() report a bad path
        }
        return { title: `Organise ${p}?`, actionLabel: 'Organise', details, detailsKind: 'text' };
      },
      async run({ path: p }) {
        const dir = deps.guard.resolve(p);
        const plan = organizePlan(dir);
        if (plan.length === 0) return ok('Nothing to tidy: no loose files of known types.');
        const moved = new Map<string, number>();
        for (const { file, category } of plan) {
          const target = path.join(dir, category);
          await mkdir(target, { recursive: true });
          await rename(path.join(dir, file), path.join(target, freeName(target, file)));
          moved.set(category, (moved.get(category) ?? 0) + 1);
        }
        return ok(
          `Moved ${plan.length} files: ${[...moved].map(([c, n]) => `${n} to ${c}`).join(', ')}.`,
        );
      },
    }),
  ];
}
