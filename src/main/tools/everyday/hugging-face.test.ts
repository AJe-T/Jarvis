import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import { createPathGuard } from '../../security/path-guard';
import type { Tool } from '../types';
import { createHuggingFaceTools } from './hugging-face';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-hf-'));
const guard = createPathGuard({ allowedRoots: () => [dir], deniedPaths: () => [] });
const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

function setup(respond: (url: string, init?: RequestInit) => Response, token = 'hf_test') {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const tools = createHuggingFaceTools({
    token: () => token || undefined,
    guard,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof fetch,
  });
  const tool = (name: string): Tool => tools.find((t) => t.name === name) as Tool;
  const run = (name: string, input: unknown) => tool(name).run(tool(name).input.parse(input), ctx);
  return { calls, tool, run };
}
const text = (o: { content: Array<{ type: string; text?: string }> }): string =>
  o.content.map((c) => c.text ?? '').join(' ');

describe('HuggingGPT tools (idea from microsoft/JARVIS)', () => {
  it('find_ai_models asks the Hub for served models of a task, most downloaded first', async () => {
    const t = setup(() =>
      Response.json([
        {
          id: 'facebook/detr-resnet-50',
          downloads: 222072,
          likes: 982,
          tags: ['license:apache-2.0'],
        },
      ]),
    );
    const out = await t.run('find_ai_models', { task: 'object-detection' });
    const url = new URL(t.calls[0]?.url ?? '');
    expect(url.searchParams.get('pipeline_tag')).toBe('object-detection');
    expect(url.searchParams.get('inference_provider')).toBe('hf-inference');
    expect(url.searchParams.get('sort')).toBe('downloads');
    expect(text(out)).toContain(
      'facebook/detr-resnet-50 — 222072 downloads, 982 likes, apache-2.0',
    );
  });

  it('runs a text task with the default model and the token', async () => {
    const t = setup(() => Response.json([{ summary_text: 'Short.' }]));
    const out = await t.run('run_ai_model', { task: 'summarization', text: 'A long story.' });
    expect(t.calls[0]?.url).toBe(
      'https://router.huggingface.co/hf-inference/models/facebook/bart-large-cnn',
    );
    expect((t.calls[0]?.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer hf_test',
    );
    expect(JSON.parse(t.calls[0]?.init?.body as string)).toEqual({ inputs: 'A long story.' });
    expect(text(out)).toContain('Short.');
  });

  it('sends an image file as the body; that needs confirmation', async () => {
    const img = join(dir, 'cat.jpg');
    writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff]));
    const t = setup(() => Response.json([{ label: 'cat', score: 0.98, box: {} }]));
    const tool = t.tool('run_ai_model');
    const input = tool.input.parse({ task: 'object-detection', file: img });
    expect(typeof tool.tier === 'function' && tool.tier(input)).toBe('CONFIRM');
    const out = await t.run('run_ai_model', { task: 'object-detection', file: img });
    expect((t.calls[0]?.init?.headers as Record<string, string>)['content-type']).toBe(
      'image/jpeg',
    );
    expect(text(out)).toContain('"label":"cat"');
    expect(() => tool.input.parse({ task: 'translation', text: 'x', model: '../..' })).toThrow();
    const plain = tool.input.parse({ task: 'translation', text: 'hello' });
    expect(typeof tool.tier === 'function' && tool.tier(plain)).toBe('SAFE');
  });

  it('text-to-image saves the picture inside the allowed folders', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const t = setup(() => new Response(png, { headers: { 'content-type': 'image/png' } }));
    const out = await t.run('run_ai_model', {
      task: 'text-to-image',
      text: 'an arc reactor',
      save_to: join(dir, 'reactor.png'),
    });
    expect(readFileSync(join(dir, 'reactor.png'))).toEqual(png);
    expect(out.content.some((c) => c.type === 'image')).toBe(true);
    await expect(
      t.run('run_ai_model', { task: 'text-to-image', text: 'x', save_to: 'C:\\Windows\\x.png' }),
    ).rejects.toThrow(/outside|protected/);
  });

  it('explains what is missing, and a missing token, before sending anything', async () => {
    const t = setup(() => Response.json({}), '');
    expect(text(await t.run('run_ai_model', { task: 'object-detection' }))).toMatch(/needs a file/);
    await expect(t.run('run_ai_model', { task: 'summarization', text: 'x' })).rejects.toThrow(
      /Hugging Face token/,
    );
    expect(t.calls).toHaveLength(0);
  });
});
