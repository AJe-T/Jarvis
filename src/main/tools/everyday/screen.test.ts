import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import { createFakeOs } from '../native/os';
import type { Tool } from '../types';
import { createScreenTools } from './screen';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

describe('read_screen_text (isair/jarvis screenshot OCR, Windows engine)', () => {
  it('OCRs a temporary screenshot, passes its path as a parameter, then deletes it', async () => {
    const os = createFakeOs({ psJson: () => ({ lines: ['Error 404: build failed', ' '] }) });
    const tool = createScreenTools(os).find((t) => t.name === 'read_screen_text') as Tool;
    expect(tool.tier).toBe('CONFIRM');
    const out = await tool.run(tool.input.parse({}), ctx);
    expect(out.content).toEqual([{ type: 'text', text: 'Error 404: build failed' }]);
    const call = os.calls.find((c) => c.op === 'psJson');
    const file = (call?.args[1] as { path: string }).path;
    expect(file).toMatch(/jarvis-ocr-.*\.png$/);
    expect(String(call?.args[0])).not.toContain(file);
    expect(existsSync(file)).toBe(false);
  });

  it('says so when the screen has no text', async () => {
    const os = createFakeOs({ psJson: () => ({ lines: [] }) });
    const tool = createScreenTools(os).find((t) => t.name === 'read_screen_text') as Tool;
    const out = await tool.run(tool.input.parse({}), ctx);
    expect(JSON.stringify(out)).toContain('No readable text');
  });
});
