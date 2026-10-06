import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkShellScript } from './shell-guard';

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../../../tests/fixtures/shell-corpus.json'), 'utf8'),
) as Array<{
  script: string;
  expected: 'BLOCKED' | 'CONFIRM';
}>;

describe('shell guard', () => {
  it('has a corpus of at least 60 cases (Testing.md §6.2)', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(60);
  });

  it.each(corpus)('$expected: $script', ({ script, expected }) => {
    const verdict = checkShellScript(script);
    expect(verdict.blocked ? 'BLOCKED' : 'CONFIRM').toBe(expected);
    if (verdict.blocked) expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it('decodes -EncodedCommand payloads and blocks what is inside', () => {
    const inner = Buffer.from(
      'Set-MpPreference -DisableRealtimeMonitoring $true',
      'utf16le',
    ).toString('base64');
    expect(checkShellScript(`powershell -NoProfile -enc ${inner}`).reasons).toContain(
      'Windows Defender settings',
    );
  });
});
