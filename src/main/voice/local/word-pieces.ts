/**
 * ADR-044: turns a wake phrase ("Hey Jarvis") into the keyword spotter's word pieces
 * ("▁HE Y ▁JA R VI S"), so any name works without training. The spotter's `bpe.model` is a
 * SentencePiece unigram model: every piece has a log-probability, and a word splits into the
 * pieces with the highest total (Viterbi). Our own reader of the published file format.
 */

/** SentencePiece marks the start of a word with this character. */
const WORD_START = '▁';
/** Piece type NORMAL (1); control, unknown and byte pieces are never used for keywords. */
const NORMAL = 1;

interface Cursor {
  at: number;
}

function varint(b: Uint8Array, c: Cursor): number {
  let value = 0;
  let scale = 1;
  for (;;) {
    if (c.at >= b.length) throw new Error('bad word-piece model');
    const byte = b[c.at++] as number;
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return value;
    scale *= 128;
    if (scale > 2 ** 49) throw new Error('bad word-piece model');
  }
}

/** Skips one protobuf field of the given wire type. */
function skip(b: Uint8Array, c: Cursor, wire: number): void {
  if (wire === 0) varint(b, c);
  else if (wire === 1) c.at += 8;
  else if (wire === 2) {
    const len = varint(b, c); // read first: `c.at += varint()` would add to the old position
    c.at += len;
  } else if (wire === 5) c.at += 4;
  else throw new Error('bad word-piece model');
  if (c.at > b.length) throw new Error('bad word-piece model');
}

/** One `SentencePiece` message: piece (1, string), score (2, float), type (3, enum). */
function readPiece(b: Uint8Array, start: number, end: number): [string, number, number] {
  const c = { at: start };
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let piece = '';
  let score = 0;
  let type = NORMAL;
  while (c.at < end) {
    const tag = varint(b, c);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) {
      const len = varint(b, c);
      piece = new TextDecoder().decode(b.subarray(c.at, c.at + len));
      c.at += len;
    } else if (field === 2 && wire === 5) {
      score = view.getFloat32(c.at, true);
      c.at += 4;
    } else if (field === 3 && wire === 0) type = varint(b, c);
    else skip(b, c, wire);
  }
  return [piece, score, type];
}

/** `ModelProto.pieces` (field 1) of a SentencePiece model → piece → log-probability. */
export function readWordPieces(model: Uint8Array): Map<string, number> {
  const pieces = new Map<string, number>();
  const c = { at: 0 };
  while (c.at < model.length) {
    const tag = varint(model, c);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) {
      const len = varint(model, c);
      const end = c.at + len;
      if (end > model.length) throw new Error('bad word-piece model');
      const [piece, score, type] = readPiece(model, c.at, end);
      if (type === NORMAL && piece && Number.isFinite(score)) pieces.set(piece, score);
      c.at = end;
    } else skip(model, c, wire);
  }
  if (pieces.size === 0) throw new Error('bad word-piece model');
  return pieces;
}

/** One word → its most likely pieces, or null when some letter has no piece. */
function splitWord(word: string, pieces: Map<string, number>): string[] | null {
  const text = WORD_START + word;
  const best = new Array<number>(text.length + 1).fill(-Infinity);
  const from = new Array<number>(text.length + 1).fill(-1);
  best[0] = 0;
  for (let end = 1; end <= text.length; end++)
    for (let start = 0; start < end; start++) {
      const score = pieces.get(text.slice(start, end));
      const before = best[start] as number;
      if (score === undefined || before === -Infinity) continue;
      if (before + score > (best[end] as number)) {
        best[end] = before + score;
        from[end] = start;
      }
    }
  if ((from[text.length] as number) < 0) return null;
  const out: string[] = [];
  for (let end = text.length; end > 0; end = from[end] as number)
    out.unshift(text.slice(from[end], end));
  return out;
}

/** Upper case, accents dropped ("Zoë" → "ZOE"), anything but letters and ' becomes a space. */
export function spotterWords(phrase: string): string[] {
  return phrase
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z']+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** "Hey Jarvis" → ["▁HE", "Y", "▁JA", "R", "VI", "S"]; null if the phrase can't be spelled. */
export function phrasePieces(phrase: string, pieces: Map<string, number>): string[] | null {
  const words = spotterWords(phrase);
  if (words.length === 0) return null;
  const out: string[] = [];
  for (const w of words) {
    const split = splitWord(w, pieces);
    if (!split) return null;
    out.push(...split);
  }
  return out;
}
