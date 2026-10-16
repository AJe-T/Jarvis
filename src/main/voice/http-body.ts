/**
 * Reads a response body but stops once it passes `max` bytes, so a misbehaving speech service
 * can't make Jarvis buffer an endless (chunked) answer.
 */
export async function readCapped(res: Response, max: number, who: string): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) throw new Error(`${who} sent too much data`);
  if (!res.body) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) {
      await res.body.cancel().catch(() => undefined);
      throw new Error(`${who} sent too much data`);
    }
    parts.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** A JSON answer of at most 1 MB (transcripts are a few KB). */
export async function readJsonCapped(res: Response, who: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readCapped(res, 1024 * 1024, who))) as unknown;
}
