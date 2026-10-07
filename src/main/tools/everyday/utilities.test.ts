import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import { createPathGuard } from '../../security/path-guard';
import { createFakeOs } from '../native/os';
import type { Tool, ToolOutput } from '../types';
import { createUtilityTools, makePassword, organizePlan } from './utilities';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};
const text = (o: ToolOutput): string => o.content.map((c) => ('text' in c ? c.text : '')).join(' ');

function setup(respond: (url: string) => Response = () => Response.json({}), root = tmpdir()) {
  const urls: string[] = [];
  const os = createFakeOs({ psJson: () => ({ ok: 4, avg: 12.4 }) });
  const tools = createUtilityTools({
    os,
    guard: createPathGuard({ allowedRoots: () => [root], deniedPaths: () => [] }),
    fetch: (async (url: string) => {
      urls.push(url);
      return respond(url);
    }) as typeof fetch,
  });
  const tool = (name: string): Tool => tools.find((t) => t.name === name) as Tool;
  const run = (name: string, input: unknown): Promise<ToolOutput> =>
    tool(name).run(tool(name).input.parse(input), ctx);
  return { urls, os, tool, run };
}

describe('everyday plugins (ideas from sukeesh/Jarvis)', () => {
  it('converts currency at the ECB rate', async () => {
    const t = setup(() => Response.json({ date: '2026-10-06', rates: { INR: 96.42 } }));
    const out = await t.run('convert_currency', { amount: 10, from: 'usd', to: 'inr' });
    expect(t.urls[0]).toBe('https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR');
    expect(text(out)).toBe('10 USD = 964.20 INR (1 USD = 96.42 INR, ECB rate of 2026-10-06).');
  });

  it('prices a stock (Yahoo) and a crypto (CoinGecko, found by symbol)', async () => {
    const t = setup((url) =>
      url.includes('yahoo')
        ? Response.json({
            chart: {
              result: [
                {
                  meta: {
                    symbol: 'RELIANCE.NS',
                    longName: 'Reliance Industries',
                    fullExchangeName: 'NSE',
                    regularMarketPrice: 1205,
                    currency: 'INR',
                    regularMarketChangePercent: -1.067,
                  },
                },
              ],
            },
          })
        : url.includes('/search')
          ? Response.json({
              coins: [
                { id: 'ethereum-wormhole', name: 'Wrapped ETH', symbol: 'WETH' },
                { id: 'ethereum', name: 'Ethereum', symbol: 'ETH' },
              ],
            })
          : Response.json({ ethereum: { inr: 251486, inr_24h_change: -3.52 } }),
    );
    expect(text(await t.run('get_market_price', { kind: 'stock', symbol: 'reliance.ns' }))).toBe(
      'Reliance Industries (RELIANCE.NS, NSE): 1205 INR, -1.07% today.',
    );
    expect(
      text(await t.run('get_market_price', { kind: 'crypto', symbol: 'eth', currency: 'INR' })),
    ).toBe('Ethereum (ETH): 251486 INR, -3.52% in 24 hours.');
  });

  it('pings through PowerShell with the host as a parameter, never in the script', async () => {
    const t = setup();
    expect(text(await t.run('network_info', { action: 'ping', host: 'example.com' }))).toBe(
      'example.com answered 4/4 pings, average 12 ms.',
    );
    const call = t.os.calls.find((c) => c.op === 'psJson');
    expect(call?.args[1]).toEqual({ host: 'example.com' });
    expect(String(call?.args[0])).not.toContain('example.com');
    expect(() =>
      t.tool('network_info').input.parse({ action: 'ping', host: 'a; rm -rf' }),
    ).toThrow();
  });

  it('puts a strong password on the clipboard and never returns it', async () => {
    const t = setup();
    const out = await t.run('generate_password', { length: 24 });
    const pw = String(t.os.calls.find((c) => c.op === 'clipboardWrite')?.args[0]);
    expect(pw).toHaveLength(24);
    expect(text(out)).not.toContain(pw);
    const p = makePassword(12, true);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/\d/);
    expect(p).toMatch(/[!@#$%^&*\-_=+?]/);
    expect(makePassword(40, false)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('organises loose files by type without overwriting; unknown files stay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-tidy-'));
    for (const f of ['a.jpg', 'b.PDF', 'c.zip', 'notes.xyz', '.hidden.png'])
      writeFileSync(join(dir, f), f);
    writeFileSync(join(dir, 'Images.keep'), '');
    const t = setup(undefined, dir);
    expect(
      organizePlan(dir)
        .map((m) => m.category)
        .sort(),
    ).toEqual(['Archives', 'Documents', 'Images']);
    expect(t.tool('organize_folder').confirm?.({ path: dir })?.details).toContain('1 → Images');
    const imagesDir = join(dir, 'Images');
    expect(text(await t.run('organize_folder', { path: dir }))).toContain('Moved 3 files');
    writeFileSync(join(dir, 'a.jpg'), 'second');
    await t.run('organize_folder', { path: dir });
    expect(readdirSync(imagesDir).sort()).toEqual(['a (1).jpg', 'a.jpg']);
    expect(existsSync(join(dir, 'notes.xyz'))).toBe(true);
    expect(existsSync(join(dir, '.hidden.png'))).toBe(true);
    await expect(t.run('organize_folder', { path: 'C:\\Windows' })).rejects.toThrow();
  });
});
