import { describe, expect, it } from 'vitest';
import { bunzip2 } from './bzip2';
import { MODEL_TAR_BZ2 } from './bzip2-fixture';
import { readTarFiles } from './tar';

/** A ustar header block for `name` (type '0' file unless given). */
function header(name: string, size: number, type = '0'): Uint8Array {
  const h = new Uint8Array(512);
  const put = (at: number, s: string): void => h.set(new TextEncoder().encode(s), at);
  put(0, name.slice(0, 100));
  put(100, '0000644\0');
  put(124, `${size.toString(8).padStart(11, '0')}\0`);
  put(156, type);
  put(257, 'ustar\u000000');
  h.fill(0x20, 148, 156);
  const sum = h.reduce((a, b) => a + b, 0);
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

const pad = (data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(Math.ceil(data.length / 512) * 512);
  out.set(data);
  return out;
};

const entry = (name: string, text: string, type = '0'): Uint8Array[] => {
  const data = new TextEncoder().encode(text);
  return [header(name, data.length, type), pad(data)];
};

async function* chunks(parts: Uint8Array[], size = 100): AsyncGenerator<Uint8Array> {
  const all = Buffer.concat(parts);
  for (let at = 0; at < all.length; at += size) yield all.subarray(at, at + size);
}

const read = (m: Map<string, Uint8Array>, k: string): string =>
  new TextDecoder().decode(m.get(k) ?? new Uint8Array());

describe('readTarFiles', () => {
  it('returns only the wanted files, across chunk boundaries', async () => {
    const tar = [
      ...entry('model/', '', '5'),
      ...entry('model/big.onnx', 'x'.repeat(1500)),
      ...entry('model/a.txt', 'alpha'),
      ...entry('./model/b.txt', 'bravo'),
      new Uint8Array(1024),
    ];
    const found = await readTarFiles(chunks(tar), new Set(['model/a.txt', 'model/b.txt']), 100);
    expect([...found.keys()].sort()).toEqual(['model/a.txt', 'model/b.txt']);
    expect(read(found, 'model/a.txt')).toBe('alpha');
    expect(read(found, 'model/b.txt')).toBe('bravo');
  });

  it('follows GNU long names and pax paths', async () => {
    const long = `model/${'n'.repeat(120)}.txt`;
    const record = (k: string, v: string): string => {
      const body = ` ${k}=${v}\n`;
      let len = body.length;
      while (`${len}${body}`.length !== len) len = `${len}${body}`.length;
      return `${len}${body}`;
    };
    const tar = [
      ...entry('././@LongLink', `${long}\0`, 'L'),
      ...entry(long.slice(0, 100), 'gnu'),
      ...entry('PaxHeaders/x', record('path', 'model/pax.txt'), 'x'),
      ...entry('short-name', 'pax'),
      new Uint8Array(1024),
    ];
    const found = await readTarFiles(chunks(tar), new Set([long, 'model/pax.txt']), 100);
    expect(read(found, long)).toBe('gnu');
    expect(read(found, 'model/pax.txt')).toBe('pax');
  });

  it('rejects a bad checksum, a truncated archive and an oversized wanted file', async () => {
    const bad = header('a.txt', 3);
    bad[0] = 0x62; // name changed after the checksum
    await expect(
      readTarFiles(chunks([bad, pad(new Uint8Array(3))]), new Set(['b.txt']), 100),
    ).rejects.toThrow(/checksum/);
    await expect(
      readTarFiles(chunks([header('a.txt', 2000)]), new Set(['a.txt']), 5000),
    ).rejects.toThrow(/truncated/);
    await expect(
      readTarFiles(chunks(entry('a.txt', 'too long')), new Set(['a.txt']), 3),
    ).rejects.toThrow(/larger than expected/);
  });

  it('stops reading once everything wanted is found', async () => {
    let pulled = 0;
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const c of chunks([...entry('a.txt', 'a'), ...entry('b.txt', 'b')], 512)) {
        pulled++;
        yield c;
      }
    }
    await readTarFiles(counted(), new Set(['a.txt']), 10);
    expect(pulled).toBe(2); // header + data of a.txt, never b.txt
  });

  it('reads a real .tar.bz2 written by GNU tar and bzip2', async () => {
    const found = await readTarFiles(
      bunzip2(new Uint8Array(Buffer.from(MODEL_TAR_BZ2, 'base64'))),
      new Set(['kws-test/enc.onnx', 'kws-test/tokens.txt']),
      100,
    );
    expect(read(found, 'kws-test/enc.onnx')).toBe('ENCODER-BYTES');
    expect(read(found, 'kws-test/tokens.txt')).toBe('TOKENS');
  });
});
