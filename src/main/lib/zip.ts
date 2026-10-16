import { open, type FileHandle } from 'node:fs/promises';
import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';

const inflate = promisify(inflateRaw);

/**
 * Reads ONE file out of a .zip without loading the archive (chat exports can be gigabytes of
 * images; we only want conversations.json). Stored and deflated entries, ZIP64 included.
 * Our own reader over node:zlib, following the published ZIP format (PKWARE APPNOTE).
 */

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;
const U32_MAX = 0xffffffff;
/** A central directory is small; anything claiming more is broken or hostile. */
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 500_000;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

const num64 = (b: Buffer, at: number): number => Number(b.readBigUInt64LE(at));

interface Directory {
  count: number;
  size: number;
  offset: number;
}

/** Where the central directory is (from the end record, or its ZIP64 version). */
async function findDirectory(fh: FileHandle): Promise<Directory> {
  const { size } = await fh.stat();
  const tailLen = Math.min(size, 22 + MAX_COMMENT + 20);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let e = tail.length - 22;
  while (e >= 0 && tail.readUInt32LE(e) !== EOCD) e--;
  if (e < 0) throw new Error('not a zip file');
  const locAt = e - 20;
  if (locAt < 0 || tail.readUInt32LE(locAt) !== ZIP64_LOCATOR)
    return {
      count: tail.readUInt16LE(e + 10),
      size: tail.readUInt32LE(e + 12),
      offset: tail.readUInt32LE(e + 16),
    };
  const z = await readAt(fh, num64(tail, locAt + 8), 56);
  if (z.readUInt32LE(0) !== ZIP64_EOCD) throw new Error('broken ZIP64 record');
  return { count: num64(z, 32), size: num64(z, 40), offset: num64(z, 48) };
}

/** ZIP64 extra field: the real values, in this order, only for the fields that overflowed. */
function applyZip64(extra: Buffer, e: ZipEntry): ZipEntry {
  const out = { ...e };
  for (let x = 0; x + 4 <= extra.length; x += 4 + extra.readUInt16LE(x + 2)) {
    if (extra.readUInt16LE(x) !== 0x0001) continue;
    let q = x + 4;
    const next = (): number => {
      const v = num64(extra, q);
      q += 8;
      return v;
    };
    if (out.size === U32_MAX) out.size = next();
    if (out.compressedSize === U32_MAX) out.compressedSize = next();
    if (out.localOffset === U32_MAX) out.localOffset = next();
  }
  return out;
}

/** The central directory's entries. Throws on anything that isn't a readable zip. */
export async function listZip(fh: FileHandle): Promise<ZipEntry[]> {
  const dir = await findDirectory(fh);
  if (dir.size > MAX_DIRECTORY_BYTES || dir.count > MAX_ENTRIES)
    throw new Error('the archive directory is too large');
  const cd = await readAt(fh, dir.offset, dir.size);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < dir.count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== CENTRAL) throw new Error('broken central directory');
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    // Bit 11: UTF-8 names; older tools wrote CP437, which is the same for plain ASCII.
    const utf8 = (cd.readUInt16LE(p + 8) & 0x800) !== 0;
    const nameEnd = p + 46 + nameLen;
    entries.push(
      applyZip64(cd.subarray(nameEnd, nameEnd + extraLen), {
        name: cd.subarray(p + 46, nameEnd).toString(utf8 ? 'utf8' : 'latin1'),
        method: cd.readUInt16LE(p + 10),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localOffset: cd.readUInt32LE(p + 42),
      }),
    );
    p = nameEnd + extraLen + commentLen;
  }
  return entries;
}

/** One entry's contents, refusing anything over `maxBytes` (before and while inflating). */
async function readEntry(
  fh: FileHandle,
  entry: ZipEntry,
  maxBytes: number,
): Promise<{ name: string; data: Buffer }> {
  if (entry.size > maxBytes || entry.compressedSize > maxBytes)
    throw new Error(`${entry.name} is larger than ${Math.round(maxBytes / 1e6)} MB`);
  const head = await readAt(fh, entry.localOffset, 30);
  if (head.length < 30 || head.readUInt32LE(0) !== LOCAL) throw new Error('broken local header');
  const start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = await readAt(fh, start, entry.compressedSize);
  if (entry.method === 0) return { name: entry.name, data: raw };
  if (entry.method === 8)
    return { name: entry.name, data: await inflate(raw, { maxOutputLength: maxBytes }) };
  throw new Error(`unsupported compression (method ${entry.method})`);
}

/** The contents of the first entry `pick` accepts (null if none), refusing entries over `maxBytes`. */
export async function readZipFile(
  path: string,
  pick: (name: string) => boolean,
  maxBytes: number,
): Promise<{ name: string; data: Buffer } | null> {
  const fh = await open(path, 'r');
  try {
    const entry = (await listZip(fh)).find((x) => pick(x.name));
    return entry ? await readEntry(fh, entry, maxBytes) : null;
  } finally {
    await fh.close();
  }
}

/**
 * Every entry `pick` accepts, in archive order. `maxBytes` caps each entry and `maxTotal` all of
 * them together (an Office file is a zip of XML parts; a crafted one could inflate to gigabytes).
 */
export async function readZipFiles(
  path: string,
  pick: (name: string) => boolean,
  maxBytes: number,
  maxTotal: number,
): Promise<Array<{ name: string; data: Buffer }>> {
  const fh = await open(path, 'r');
  try {
    const out: Array<{ name: string; data: Buffer }> = [];
    let total = 0;
    const tooBig = (): Error =>
      new Error(`the parts add up to more than ${Math.round(maxTotal / 1e6)} MB`);
    for (const entry of (await listZip(fh)).filter((x) => pick(x.name))) {
      if (total + entry.size > maxTotal) throw tooBig(); // declared size: skip inflating at all
      const part = await readEntry(fh, entry, maxBytes);
      total += part.data.length; // real size: a header may lie
      if (total > maxTotal) throw tooBig();
      out.push(part);
    }
    return out;
  } finally {
    await fh.close();
  }
}
