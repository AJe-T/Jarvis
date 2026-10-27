import { describe, expect, it } from 'vitest';
import { CLOUD_PROVIDERS } from '@shared/llm-providers';
import { isProtectedSecret } from './mcp';

describe('MCP secret binding guard (Security.md §10)', () => {
  it("never lets a community server take an AI provider's key", () => {
    for (const p of CLOUD_PROVIDERS) expect(isProtectedSecret(p.secret)).toBe(true);
  });

  it("protects Jarvis's internal secrets (phone remote, WhatsApp, voice)", () => {
    for (const n of ['remote_cert', 'whatsapp_creds', 'voice_profile'])
      expect(isProtectedSecret(n)).toBe(true);
  });

  it("protects the keys of Sir's own AI Router providers", () => {
    expect(isProtectedSecret('custom_ai_1')).toBe(true);
  });

  it("leaves a server's own new key free to bind", () => {
    expect(isProtectedSecret('my_weather_key')).toBe(false);
  });
});
