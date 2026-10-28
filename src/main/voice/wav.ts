/** The 44-byte header of a 16-bit mono PCM WAV file holding `dataBytes` bytes of samples. */
export function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

/** Float samples in [-1, 1] → a 16-bit mono WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = Buffer.alloc(44 + samples.length * 2);
  wavHeader(samples.length * 2, sampleRate).copy(buf, 0);
  for (let i = 0; i < samples.length; i++)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32767), 44 + i * 2);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
