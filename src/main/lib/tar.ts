/**
 * Pulls named files out of a tar stream (ADR-044, the keyword-spotter model archive). Our own
 * reader of the POSIX ustar layout with the GNU long-name and pax path extensions; header
 * checksums are verified. Stops reading once every wanted file is found.
 */

const BLOCK = 512;

/** Hands out exact byte counts from a stream of chunks. */
class ByteQueue {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private ended = false;
  constructor(private readonly source: AsyncIterator<Uint8Array>) {}

  private async fill(n: number): Promise<boolean> {
    while (this.size < n && !this.ended) {
      const next = await this.source.next();
      if (next.done) this.ended = true;
      else if (next.value.length) {
        this.chunks.push(next.value);
        this.size += next.value.length;
      }
    }
    return this.size >= n;
  }

  /** Exactly n bytes, or null when the stream ends first. */
  async take(n: number): Promise<Uint8Array | null> {
    if (!(await this.fill(n))) return null;
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const head = this.chunks[0] as Uint8Array;
      const part = Math.min(head.length, n - at);
      out.set(head.subarray(0, part), at);
      at += part;
      if (part === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(part);
    }
    this.size -= n;
    return out;
  }

  /** Skips n bytes without keeping them. */
  async skip(n: number): Promise<boolean> {
    let left = n;
    while (left > 0) {
      if (!(await this.fill(1))) return false;
      const head = this.chunks[0] as Uint8Array;
      const part = Math.min(head.length, left);
      if (part === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(part);
      this.size -= part;
      left -= part;
    }
    return true;
  }
}

const text = (b: Uint8Array, at: number, len: number): string => {
  const field = b.subarray(at, at + len);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end < 0 ? field : field.subarray(0, end));
};

/** Octal number field, or GNU base-256 when the high bit of the first byte is set. */
function number(b: Uint8Array, at: number, len: number): number {
  if (((b[at] as number) & 0x80) !== 0) {
    let v = (b[at] as number) & 0x7f;
    for (let i = 1; i < len; i++) v = v * 256 + (b[at + i] as number);
    return v;
  }
  const s = text(b, at, len).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error('tar header has a bad number');
  return s ? parseInt(s, 8) : 0;
}

function checksumOk(h: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (h[i] as number);
  return sum === number(h, 148, 8);
}

/** pax extended header records ("27 path=some/long/name\n") → the path, if any. */
function paxPath(data: Uint8Array): string | null {
  const s = new TextDecoder().decode(data);
  let path: string | null = null;
  for (let at = 0; at < s.length;) {
    const space = s.indexOf(' ', at);
    const len = parseInt(s.slice(at, space), 10);
    if (space < 0 || !(len > 0)) break;
    const record = s.slice(space + 1, at + len - 1);
    const eq = record.indexOf('=');
    if (record.slice(0, eq) === 'path') path = record.slice(eq + 1);
    at += len;
  }
  return path;
}

const clean = (name: string): string => name.replace(/^(\.\/)+/, '');

/**
 * Reads the stream until every name in `want` is found (or the archive ends) and returns those
 * files. Directory and link entries are ignored; a wanted file larger than maxFileBytes throws.
 */
export async function readTarFiles(
  chunks: AsyncIterable<Uint8Array>,
  want: ReadonlySet<string>,
  maxFileBytes: number,
): Promise<Map<string, Uint8Array>> {
  const iterator = chunks[Symbol.asyncIterator]();
  const q = new ByteQueue(iterator);
  const found = new Map<string, Uint8Array>();
  let longName: string | null = null;
  try {
    while (found.size < want.size) {
      const h = await q.take(BLOCK);
      if (!h || h.every((b) => b === 0)) break;
      if (!checksumOk(h)) throw new Error('tar header failed its checksum');
      const size = number(h, 124, 12);
      const type = String.fromCharCode(h[156] as number);
      const padded = Math.ceil(size / BLOCK) * BLOCK;
      const magic = text(h, 257, 6);
      const prefix = magic.startsWith('ustar') ? text(h, 345, 155) : '';
      const name = clean(longName ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100)));
      longName = null;

      if (type === 'L' || type === 'x') {
        if (size > 64 * 1024) throw new Error('tar header extension is too large');
        const data = await q.take(padded);
        if (!data) throw new Error('tar archive is truncated');
        const body = data.subarray(0, size);
        longName = type === 'L' ? text(body, 0, body.length) : paxPath(body);
        continue;
      }
      const regular = type === '0' || type === '\0' || type === '7';
      if (regular && want.has(name)) {
        if (size > maxFileBytes) throw new Error(`${name} in the archive is larger than expected`);
        const data = await q.take(padded);
        if (!data) throw new Error('tar archive is truncated');
        found.set(name, data.subarray(0, size));
      } else if (!(await q.skip(padded))) throw new Error('tar archive is truncated');
    }
  } finally {
    await iterator.return?.(); // stop decompressing: the rest isn't needed
  }
  return found;
}
