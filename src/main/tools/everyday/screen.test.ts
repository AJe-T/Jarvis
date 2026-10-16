import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import { createFakeOs } from '../native/os';
import type { Tool } from '../types';
import { createScreenTools, screenshotName } from './screen';

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

describe('save_screenshot (Gladiator07/JARVIS, BolisettySujith/J.A.R.V.I.S)', () => {
  it('saves full-resolution PNGs to Pictures\\Jarvis and never overwrites', async () => {
    const pictures = mkdtempSync(join(tmpdir(), 'jarvis-pics-'));
    const os = createFakeOs({});
    const tool = createScreenTools(os, pictures).find((t) => t.name === 'save_screenshot') as Tool;
    expect(tool.tier).toBe('CONFIRM');
    await tool.run(tool.input.parse({ name: 'invoice: march?' }), ctx);
    await tool.run(tool.input.parse({ name: 'invoice: march?' }), ctx);
    const files = readdirSync(join(pictures, 'Jarvis')).sort();
    expect(files).toEqual(['invoice march (1).png', 'invoice march.png']);
    expect(readFileSync(join(pictures, 'Jarvis', 'invoice march.png')).length).toBeGreaterThan(0);
  });

  it('cleans names and dates unnamed shots', () => {
    const at = new Date(2026, 9, 10, 14, 5, 9);
    expect(screenshotName('  ../..\\evil<>.png ', at)).toBe('evil.png');
    expect(screenshotName(undefined, at)).toBe('Screenshot 2026-10-10 14.05.09.png');
    expect(screenshotName('...', at)).toBe('Screenshot 2026-10-10 14.05.09.png');
    expect(screenshotName('CON', at)).toBe('Screenshot 2026-10-10 14.05.09.png');
    expect(screenshotName('com1.png', at)).toBe('Screenshot 2026-10-10 14.05.09.png');
    expect(screenshotName('console', at)).toBe('console.png');
  });
});
