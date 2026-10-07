import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true }, session: {}, shell: {}, ipcMain: {} }));
const { isMeterUrl } = await import('./music-meter');

describe('music meter (Security.md §7)', () => {
  it('lets only our own meter page capture loopback audio', () => {
    expect(
      isMeterUrl('file:///C:/Program%20Files/Jarvis/resources/app.asar/out/renderer/meter.html'),
    ).toBe(true);
    expect(isMeterUrl('file:///C:/app/out/renderer/index.html')).toBe(false);
    expect(isMeterUrl('https://evil.example/meter.html')).toBe(false);
    expect(isMeterUrl('')).toBe(false);
  });
});
