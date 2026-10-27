import { describe, expect, it } from 'vitest';
import { parseEnvKeys } from './env-import';

describe('.env key import', () => {
  it('finds known provider keys in the usual .env shapes', () => {
    const keys = parseEnvKeys(
      [
        '# FreeLLMAPI keys',
        'GROQ_API_KEY=gsk_abc123',
        'export GEMINI_API_KEY="AIzaXYZ"',
        "CEREBRAS_API_KEY='csk-1' # personal",
        'OPENROUTER_API_KEY=sk-or-v1-9 # trailing comment',
        'PORT=3001',
        'MISTRAL_API_KEY=',
        'NVIDIA_API_KEY=your-key-here',
      ].join('\n'),
    );
    expect(keys.map((k) => [k.name, k.provider, k.value])).toEqual([
      ['GROQ_API_KEY', 'groq', 'gsk_abc123'],
      ['GEMINI_API_KEY', 'gemini', 'AIzaXYZ'],
      ['CEREBRAS_API_KEY', 'cerebras', 'csk-1'],
      ['OPENROUTER_API_KEY', 'openrouter', 'sk-or-v1-9'],
    ]);
  });

  it('ignores the same key pasted twice and values that cannot be keys', () => {
    expect(parseEnvKeys('GROQ_API_KEY=gsk_1\nGROQ_API_KEY=gsk_1')).toHaveLength(1);
    expect(parseEnvKeys('GROQ_API_KEY=has spaces inside')).toHaveLength(0);
    expect(parseEnvKeys(`GROQ_API_KEY=${'x'.repeat(500)}`)).toHaveLength(0);
  });
});
