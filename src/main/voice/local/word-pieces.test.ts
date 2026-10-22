import { describe, expect, it } from 'vitest';
import { phrasePieces, readWordPieces, spotterWords } from './word-pieces';

/** A SentencePiece model with just these pieces: [piece, log-probability, type (1 = normal)]. */
function model(pieces: Array<[string, number, number?]>): Uint8Array {
  const bytes: number[] = [];
  const varint = (out: number[], n: number): void => {
    while (n >= 0x80) {
      out.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    out.push(n);
  };
  for (const [piece, score, type = 1] of pieces) {
    const msg: number[] = [];
    const text = [...new TextEncoder().encode(piece)];
    msg.push(0x0a); // field 1, length-delimited
    varint(msg, text.length);
    msg.push(...text);
    msg.push(0x15); // field 2, 32-bit
    const f = new DataView(new ArrayBuffer(4));
    f.setFloat32(0, score, true);
    msg.push(...new Uint8Array(f.buffer));
    msg.push(0x18, type); // field 3, varint
    bytes.push(0x0a);
    varint(bytes, msg.length);
    bytes.push(...msg);
  }
  bytes.push(0x12, 0x02, 0x08, 0x01); // a trainer_spec (field 2) the reader must skip
  return Uint8Array.from(bytes);
}

const P = readWordPieces(
  model([
    ['<unk>', 0, 2],
    ['▁', -3],
    ['▁HE', -4],
    ['Y', -3],
    ['▁HEY', -9], // less likely than ▁HE + Y (-7)
    ['▁JA', -5],
    ['R', -3],
    ['VI', -4],
    ['S', -3],
    ['J', -6],
    ['A', -3],
    ['V', -4],
    ['I', -4],
  ]),
);

describe('word pieces (SentencePiece unigram)', () => {
  it('reads normal pieces and their scores, skipping other types and fields', () => {
    expect(P.get('▁HE')).toBeCloseTo(-4);
    expect(P.has('<unk>')).toBe(false);
    expect(P.size).toBe(12);
  });

  it('splits words into the most likely pieces', () => {
    expect(phrasePieces('Hey Jarvis', P)).toEqual(['▁HE', 'Y', '▁JA', 'R', 'VI', 'S']);
    expect(phrasePieces('hey, JARVIS!', P)).toEqual(phrasePieces('Hey Jarvis', P));
  });

  it('gives null when a letter has no piece or nothing is left', () => {
    expect(phrasePieces('Hey Bob', P)).toBeNull();
    expect(phrasePieces('...', P)).toBeNull();
  });

  it('normalises words: accents dropped, symbols split', () => {
    expect(spotterWords('Zoë-Ann  O’Neil')).toEqual(['ZOE', 'ANN', 'O', 'NEIL']);
    expect(spotterWords("o'neil")).toEqual(["O'NEIL"]);
  });

  it('rejects a broken model', () => {
    expect(() => readWordPieces(Uint8Array.from([0x0a, 0x7f, 0x01]))).toThrow(/bad word-piece/);
    expect(() => readWordPieces(new Uint8Array())).toThrow(/bad word-piece/);
  });
});
