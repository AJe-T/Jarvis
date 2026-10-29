/** One recorded clip through Deepgram's pre-recorded API (Nova-3), e.g. a Telegram note or a voice check. */
export async function deepgramFile(o: {
  key: string;
  data: Uint8Array;
  mime: string;
  language: string;
  fetch?: typeof fetch;
}): Promise<string> {
  const lang = o.language === 'auto' ? 'multi' : o.language;
  const res = await (o.fetch ?? fetch)(
    `https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=${encodeURIComponent(lang)}`,
    {
      method: 'POST',
      headers: { authorization: `Token ${o.key}`, 'content-type': o.mime },
      body: Buffer.from(o.data),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw new Error(`Deepgram: HTTP ${res.status}`);
  const j = (await res.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  };
  return j.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}
