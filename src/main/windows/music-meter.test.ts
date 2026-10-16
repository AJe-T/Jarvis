import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true }, session: {}, shell: {}, ipcMain: {} }));
const { isMeterUrl } = await import('./music-meter');
const { isArtifactUrl } = await import('./hardening');
const { isCaptureUrl } = await import('./capture-window');

/** The app's own bundled page, as hardening.ts resolves it (this test sits beside it). */
const own = (name: string): string => pathToFileURL(join(__dirname, '../renderer', name)).href;

describe('privileged app pages (Security.md §7)', () => {
  it('lets only our own meter page capture loopback audio', () => {
    expect(isMeterUrl(own('meter.html'))).toBe(true);
    expect(isMeterUrl(own('index.html'))).toBe(false);
    expect(isMeterUrl('https://evil.example/meter.html')).toBe(false);
    expect(isMeterUrl('')).toBe(false);
  });

  it('a different file with the same name never gets the page’s privileges', () => {
    // e.g. a chat artifact Sir saved as Documents\artifact.html, then navigated to by another artifact
    expect(isArtifactUrl(own('artifact.html'))).toBe(true);
    expect(isArtifactUrl('file:///C:/Users/sir/Documents/artifact.html')).toBe(false);
    expect(isCaptureUrl(own('capture.html'))).toBe(true);
    expect(isCaptureUrl('file:///C:/Users/sir/Downloads/capture.html')).toBe(false);
    expect(isCaptureUrl(`${own('capture.html').replace('file:///', 'file://server/')}`)).toBe(
      false,
    );
  });
});
