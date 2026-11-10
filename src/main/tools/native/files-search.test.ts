import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVATE_TOOLS } from '@shared/free-pool';
import { makeZip } from '../../lib/zip-fixture';
import { logger } from '../../logging/logger';
import { createPathGuard } from '../../security/path-guard';
import type { Tool, ToolContext } from '../types';
import { createFileTools } from './files';
import { createFakeOs } from './os';

const docs = mkdtempSync(path.join(tmpdir(), 'jarvis-find-'));
const secret = path.join(docs, 'Private');
mkdirSync(secret);
mkdirSync(path.join(docs, 'Bills'));
writeFileSync(
  path.join(docs, 'Bills', 'march.txt'),
  'Avaan invoice 4471\ntotal due: 18,200 rupees',
);
writeFileSync(path.join(docs, 'notes.md'), 'call the dentist about the invoice');
writeFileSync(path.join(docs, '.env'), 'INVOICE_KEY=avaan-secret');
writeFileSync(path.join(docs, 'credentials.json'), '{"avaan":"hunter2"}');
writeFileSync(path.join(docs, '.npmrc'), '//registry/:_authToken=avaan');
writeFileSync(path.join(docs, 'blob.bin'), Buffer.from([65, 0, 118, 97, 97, 110]));
writeFileSync(path.join(secret, 'diary.txt'), 'avaan invoice, private');
writeFileSync(
  path.join(docs, 'contract.docx'),
  makeZip([
    {
      name: 'word/document.xml',
      data: '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Avaan renewal clause</w:t></w:r></w:p></w:body></w:document>',
      deflate: true,
    },
  ]),
);

const guard = createPathGuard({ allowedRoots: () => [docs], deniedPaths: () => [secret] });
const tool = createFileTools({
  os: createFakeOs({ psJson: () => ({}), clipboard: '' }),
  guard,
  roots: () => [docs],
  protectedPaths: () => [],
}).find((t) => t.name === 'search_in_files') as Tool;

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};
const find = async (input: unknown): Promise<string> => {
  const out = await tool.run(tool.input.parse(input), ctx);
  return out.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
};

describe('search_in_files', () => {
  it('is a safe, untrusted-output tool that needs at least two characters', () => {
    const tier = tool.tier as (input: { text: string }) => string;
    expect(tier({ text: 'avaan invoice' })).toBe('SAFE');
    // Hunting for secrets across every file is confirmed first (it may be a planted instruction).
    for (const text of ['password', 'api key', 'API_KEY=', 'BEGIN PRIVATE KEY', 'bank pin'])
      expect(tier({ text })).toBe('CONFIRM');
    expect(tool.untrustedOutput).toBe(true);
    // What files say is private: a turn that used it never goes to a third-party free model.
    expect(PRIVATE_TOOLS['search_in_files']).toBe('files');
    expect(tool.summarize({ text: 'invoice', ext: 'pdf' })).toBe(
      'Search inside files for "invoice" (.pdf)',
    );
    expect(tool.input.safeParse({ text: 'a' }).success).toBe(false);
    expect(tool.input.safeParse({ text: 'ok', ext: '../x' }).success).toBe(false);
  });

  it('finds files where every word appears, with the matching text', async () => {
    const out = await find({ text: 'avaan invoice' });
    expect(out).toContain(path.join('Bills', 'march.txt'));
    expect(out).toContain('Avaan invoice 4471 total due');
    expect(out).not.toContain('notes.md'); // has "invoice" but not "avaan"
  });

  it('reads Word documents and honours the extension filter', async () => {
    expect(await find({ text: 'renewal' })).toContain('contract.docx');
    const onlyText = await find({ text: 'avaan', ext: 'txt' });
    expect(onlyText).toContain('march.txt');
    expect(onlyText).not.toContain('contract.docx');
  });

  it('never opens credential files, binary files or folders the guard denies', async () => {
    const out = await find({ text: 'avaan', maxResults: 20 });
    expect(out).not.toContain('.env');
    expect(out).not.toContain('credentials.json');
    expect(out).not.toContain('.npmrc');
    expect(out).not.toContain('blob.bin');
    expect(out).not.toContain('diary.txt');
  });

  it('refuses a folder outside the allowed ones and says so when nothing matches', async () => {
    await expect(find({ text: 'avaan', folder: 'C:\\Windows\\System32' })).rejects.toThrow();
    expect(await find({ text: 'zebra crossing' })).toMatch(/No file in the allowed folders says/);
  });
});
