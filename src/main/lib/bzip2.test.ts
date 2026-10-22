import { describe, expect, it } from 'vitest';
import { bunzip2 } from './bzip2';
import { DATA_BZ2, TWO_STREAMS_BZ2, fixtureData } from './bzip2-fixture';

const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

async function all(data: Uint8Array, max?: number): Promise<{ bytes: Uint8Array; blocks: number }> {
  const parts: Uint8Array[] = [];
  for await (const block of bunzip2(data, max)) parts.push(block);
  return { bytes: new Uint8Array(Buffer.concat(parts)), blocks: parts.length };
}

describe('bunzip2', () => {
  it('decodes two blocks of runs and text exactly as bzip2 wrote them', async () => {
    const { bytes, blocks } = await all(b64(DATA_BZ2));
    expect(blocks).toBe(2);
    expect(Buffer.from(bytes).equals(Buffer.from(fixtureData()))).toBe(true);
  });

  it('reads concatenated streams', async () => {
    const { bytes } = await all(b64(TWO_STREAMS_BZ2));
    expect(new TextDecoder().decode(bytes)).toBe('hello world');
  });

  it('rejects a corrupted block, non-bzip2 data and output past the cap', async () => {
    const bad = b64(DATA_BZ2);
    bad[400] = (bad[400] as number) ^ 0x10;
    await expect(all(bad)).rejects.toThrow(/bzip2/);
    await expect(all(new TextEncoder().encode('PK\u0003\u0004 not bzip2'))).rejects.toThrow(
      /not a bzip2 file/,
    );
    await expect(all(b64(DATA_BZ2), 1000)).rejects.toThrow(/larger than allowed/);
  });

  it('rejects truncated data', async () => {
    await expect(all(b64(DATA_BZ2).subarray(0, 5000))).rejects.toThrow(/truncated|bzip2/);
  });
});
