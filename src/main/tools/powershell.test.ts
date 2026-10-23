import { describe, expect, it } from 'vitest';
import { psEnv } from './powershell';

describe('psEnv', () => {
  it('drops PSModulePath in any case and keeps everything else', () => {
    const env = psEnv({ PATH: 'C:\\Windows', PSModulePath: 'C:\\pwsh', psmodulepath: 'x' });
    expect(env).toEqual({ PATH: 'C:\\Windows', JARVIS_PS_PARAMS: '' });
  });

  it('passes params as JSON', () => {
    expect(psEnv({}, { a: 1 })['JARVIS_PS_PARAMS']).toBe('{"a":1}');
  });
});
