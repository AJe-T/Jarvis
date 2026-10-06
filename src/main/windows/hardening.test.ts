import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true }, session: {}, shell: {} }));
const { isAppUrl, isSafeExternalUrl, HARDENED_WEB_PREFERENCES } = await import('./hardening');

describe('hardening', () => {
  it('uses the Security.md §7 web preferences', () => {
    expect(HARDENED_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    });
  });

  it('treats only file: URLs as the app in packaged builds', () => {
    expect(isAppUrl('file:///C:/app/index.html')).toBe(true);
    expect(isAppUrl('https://evil.example')).toBe(false);
    expect(isAppUrl('not a url')).toBe(false);
  });

  it('allows only http(s) for external links', () => {
    expect(isSafeExternalUrl('https://github.com')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///C:/Windows')).toBe(false);
  });
});
