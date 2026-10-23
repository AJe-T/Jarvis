/**
 * bzip2 decompression (ADR-044: the keyword-spotter model ships as .tar.bz2). Our own decoder,
 * written from the published format: per block a Huffman-coded, move-to-front, run-length coded
 * Burrows–Wheeler transform, then the format's first run-length stage. Every block's CRC is
 * checked. Yields one block at a time and gives the event loop a turn between blocks, so the main
 * process stays responsive while a model unpacks.
 */

const BLOCK_MAGIC = 0x314159265359;
const END_MAGIC = 0x177245385090;
const GROUP_SIZE = 50;
const MAX_CODE_LEN = 20;
const MAX_GROUPS = 6;
const MAX_SELECTORS = 18_002; // 2 + 900 000 / 50; later ones are read and ignored, as bzip2 1.0.8

class BitReader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}

  bit(): number {
    const byte = this.data[this.pos >>> 3];
    if (byte === undefined) throw new Error('bzip2 data is truncated');
    const b = (byte >>> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return b;
  }

  /** Up to 24 bits, most significant first. */
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }

  u32(): number {
    return this.bits(16) * 0x10000 + this.bits(16);
  }

  alignToByte(): void {
    this.pos = (this.pos + 7) & ~7;
  }

  /** Bytes left from the current (byte-aligned) position. */
  rest(): Uint8Array {
    return this.data.subarray(this.pos >>> 3);
  }
}

/** bzip2's CRC-32: polynomial 0x04C11DB7, most significant bit first. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = ((c << 8) ^ (CRC_TABLE[((c >>> 24) ^ b) & 0xff] as number)) >>> 0;
  return ~c >>> 0;
}

/** Canonical Huffman decoder for one coding group. */
interface Table {
  minLen: number;
  maxLen: number;
  /** Per code length: first code, last code, index in `symbols` of its first symbol. */
  first: Int32Array;
  last: Int32Array;
  offset: Int32Array;
  symbols: Uint16Array;
}

function buildTable(lengths: Uint8Array): Table {
  let minLen = MAX_CODE_LEN;
  let maxLen = 0;
  for (const l of lengths) {
    minLen = Math.min(minLen, l);
    maxLen = Math.max(maxLen, l);
  }
  const first = new Int32Array(MAX_CODE_LEN + 2);
  const last = new Int32Array(MAX_CODE_LEN + 2).fill(-1);
  const offset = new Int32Array(MAX_CODE_LEN + 2);
  const symbols = new Uint16Array(lengths.length);
  let code = 0;
  let at = 0;
  for (let len = minLen; len <= maxLen; len++) {
    first[len] = code;
    offset[len] = at;
    lengths.forEach((l, sym) => {
      if (l !== len) return;
      symbols[at++] = sym;
      code++;
    });
    last[len] = code - 1;
    code <<= 1;
  }
  return { minLen, maxLen, first, last, offset, symbols };
}

function decodeSymbol(r: BitReader, t: Table): number {
  let len = t.minLen;
  let code = r.bits(len);
  while (code > (t.last[len] as number)) {
    if (++len > t.maxLen) throw new Error('bzip2 data has a bad Huffman code');
    code = (code << 1) | r.bit();
  }
  return t.symbols[(t.offset[len] as number) + code - (t.first[len] as number)] as number;
}

/** One block (after its magic) → its original bytes, checked against the block CRC. */
function readBlock(r: BitReader, blockMax: number, maxOut: number): Uint8Array {
  const expectedCrc = r.u32();
  if (r.bit()) throw new Error('randomised bzip2 blocks are not supported');
  const origPtr = r.bits(24);

  // Which byte values occur: 16 groups of 16.
  const used: number[] = [];
  const groupsUsed = r.bits(16);
  for (let i = 0; i < 16; i++)
    if (groupsUsed & (0x8000 >>> i)) {
      const w = r.bits(16);
      for (let j = 0; j < 16; j++) if (w & (0x8000 >>> j)) used.push(i * 16 + j);
    }
  if (used.length === 0) throw new Error('bzip2 block uses no symbols');
  const alphaSize = used.length + 2;
  const eob = alphaSize - 1;

  const nGroups = r.bits(3);
  const nSelectors = r.bits(15);
  if (nGroups < 2 || nGroups > MAX_GROUPS || nSelectors < 1)
    throw new Error('bzip2 block has a bad header');
  const order = Array.from({ length: nGroups }, (_, i) => i);
  const selectors = new Uint8Array(Math.min(nSelectors, MAX_SELECTORS));
  for (let i = 0; i < nSelectors; i++) {
    let j = 0;
    while (r.bit()) if (++j >= nGroups) throw new Error('bzip2 block has a bad selector');
    const g = order[j] as number;
    order.splice(j, 1);
    order.unshift(g);
    if (i < selectors.length) selectors[i] = g;
  }

  const tables: Table[] = [];
  for (let t = 0; t < nGroups; t++) {
    const lengths = new Uint8Array(alphaSize);
    let len = r.bits(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (len < 1 || len > MAX_CODE_LEN) throw new Error('bzip2 block has a bad code length');
        if (!r.bit()) break;
        len += r.bit() ? -1 : 1;
      }
      lengths[s] = len;
    }
    tables.push(buildTable(lengths));
  }

  // Huffman → move-to-front + zero runs (RUNA/RUNB, bijective base 2) → the BWT column.
  const mtf = Uint8Array.from(used.keys());
  const column = new Uint32Array(blockMax);
  const counts = new Int32Array(256);
  let n = 0;
  let selector = 0;
  let left = 0;
  let table = tables[0] as Table;
  let run = 0;
  let weight = 1;
  for (;;) {
    if (left === 0) {
      if (selector >= selectors.length) throw new Error('bzip2 block ran out of selectors');
      table = tables[selectors[selector++] as number] as Table;
      left = GROUP_SIZE;
    }
    left--;
    const sym = decodeSymbol(r, table);
    if (sym <= 1) {
      run += weight << sym; // RUNA adds 1×, RUNB 2× the current weight
      weight <<= 1;
      if (run > blockMax) throw new Error('bzip2 block is too long');
      continue;
    }
    if (run > 0) {
      const byte = used[mtf[0] as number] as number;
      if (n + run > blockMax) throw new Error('bzip2 block is too long');
      column.fill(byte, n, n + run);
      counts[byte] = (counts[byte] as number) + run;
      n += run;
      run = 0;
      weight = 1;
    }
    if (sym === eob) break;
    const idx = sym - 1;
    const v = mtf[idx] as number;
    mtf.copyWithin(1, 0, idx);
    mtf[0] = v;
    const byte = used[v] as number;
    if (n >= blockMax) throw new Error('bzip2 block is too long');
    column[n++] = byte;
    counts[byte] = (counts[byte] as number) + 1;
  }
  if (origPtr >= n) throw new Error('bzip2 block has a bad origin pointer');

  // Inverse BWT: each entry keeps its byte (low 8 bits) and the index of the next one.
  const next = new Int32Array(256);
  for (let i = 0, sum = 0; i < 256; i++) {
    next[i] = sum;
    sum += counts[i] as number;
  }
  for (let i = 0; i < n; i++) {
    const b = (column[i] as number) & 0xff;
    const at = next[b] as number;
    column[at] = ((column[at] as number) | (i << 8)) >>> 0;
    next[b] = at + 1;
  }

  // First-stage run length: four equal bytes are followed by a count of extra copies.
  let out = new Uint8Array(Math.min(maxOut, n * 2 + 16));
  let size = 0;
  const push = (b: number, times: number): void => {
    if (size + times > out.length) {
      if (size + times > maxOut) throw new Error('bzip2 data is larger than allowed');
      const bigger = new Uint8Array(Math.min(maxOut, Math.max(out.length * 2, size + times)));
      bigger.set(out.subarray(0, size));
      out = bigger;
    }
    out.fill(b, size, size + times);
    size += times;
  };
  let pos = (column[origPtr] as number) >>> 8;
  let last = -1;
  let same = 0;
  for (let k = 0; k < n; k++) {
    const entry = column[pos] as number;
    const b = entry & 0xff;
    pos = entry >>> 8;
    if (same === 4) {
      if (b > 0) push(last, b);
      same = 0;
      last = -1;
      continue;
    }
    if (b === last) same++;
    else {
      last = b;
      same = 1;
    }
    push(b, 1);
  }
  const block = out.subarray(0, size);
  if (crc32(block) !== expectedCrc) throw new Error('bzip2 block failed its CRC check');
  return block;
}

/** .bz2 bytes → the original bytes, one block at a time (concatenated streams included). */
export async function* bunzip2(
  data: Uint8Array,
  maxBytes = 1024 * 1024 * 1024,
): AsyncGenerator<Uint8Array> {
  let rest = data;
  let total = 0;
  do {
    if (rest[0] !== 0x42 || rest[1] !== 0x5a || rest[2] !== 0x68)
      throw new Error('not a bzip2 file');
    const level = (rest[3] ?? 0) - 0x30;
    if (level < 1 || level > 9) throw new Error('not a bzip2 file');
    const r = new BitReader(rest.subarray(4));
    for (;;) {
      const magic = r.bits(24) * 0x1000000 + r.bits(24);
      if (magic === END_MAGIC) {
        r.u32(); // combined CRC: every block was already checked
        r.alignToByte();
        break;
      }
      if (magic !== BLOCK_MAGIC) throw new Error('bzip2 data has a bad block');
      const block = readBlock(r, level * 100_000, maxBytes - total);
      total += block.length;
      yield block;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    rest = r.rest();
  } while (rest.length >= 4 && rest[0] === 0x42);
}
