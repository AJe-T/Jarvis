// API-Guide.md §9.4 speech shaping: what Jarvis says aloud is a cleaned, sentence-chunked subset of the reply.

const ABBREVIATIONS =
  /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|no|approx|fig|jr|sr|inc|ltd|a\.m|p\.m)\.$/i;
const MIN_SENTENCE = 20;
const MAX_CHUNK = 200;

/** Removes Markdown so TTS doesn't read symbols; code and tables are summarised for the screen. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " I've put the code on screen. ")
    .replace(/^\s*\|.*\|\s*$/gm, '§TABLE§')
    .replace(/(§TABLE§\s*)+/g, ' The details are on screen. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/**
 * Streams sentences out of incremental text. Splits at . ! ? followed by whitespace once ≥ 20
 * chars are buffered (not after abbreviations like "e.g."), or at a space past 200 chars.
 */
export class SentenceChunker {
  private buffer = '';

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === -1) break;
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }

  private findCut(): number {
    const re = /[.!?]+["')\]]?(?=\s)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buffer))) {
      const end = m.index + m[0].length;
      if (end < MIN_SENTENCE) continue;
      if (ABBREVIATIONS.test(this.buffer.slice(Math.max(0, end - 6), end))) continue;
      return end;
    }
    if (this.buffer.length > MAX_CHUNK) {
      const space = this.buffer.lastIndexOf(' ', MAX_CHUNK);
      return space > MIN_SENTENCE ? space : MAX_CHUNK;
    }
    return -1;
  }
}

/**
 * Agents.md §B1 voice format: only the <spoken>…</spoken> block is read aloud. If the model forgets
 * the block, the first two sentences of the (stripped) reply are spoken instead.
 */
export class SpokenExtractor {
  private raw = '';
  private mode: 'pending' | 'inside' | 'done' | 'fallback' = 'pending';
  private emitted = 0;
  private fallbackSentences = 0;

  /** Returns newly speakable text (already Markdown-stripped). */
  push(delta: string): string {
    this.raw += delta;
    if (this.mode === 'done') return '';
    if (this.mode === 'pending') {
      const trimmed = this.raw.trimStart();
      if (trimmed.startsWith('<spoken>')) {
        this.mode = 'inside';
        this.emitted = this.raw.indexOf('<spoken>') + '<spoken>'.length;
      } else if (trimmed.length >= 9 || (trimmed.length > 0 && !'<spoken>'.startsWith(trimmed))) {
        this.mode = 'fallback';
      } else return '';
    }
    if (this.mode === 'inside') {
      const close = this.raw.indexOf('</spoken>', this.emitted);
      // Hold back a possible partial closing tag at the end of the buffer.
      const safeEnd =
        close !== -1 ? close : Math.max(this.emitted, this.raw.length - '</spoken>'.length);
      const text = this.raw.slice(this.emitted, safeEnd);
      this.emitted = safeEnd;
      if (close !== -1) this.mode = 'done';
      return text;
    }
    // Fallback: speak up to two complete sentences of the visible reply (Markdown stripped first,
    // so periods inside links/code don't count as sentence ends).
    const sentences = stripMarkdown(this.raw).match(/[^.!?]+[.!?]+(?=\s)/g) ?? [];
    const fresh = sentences.slice(this.fallbackSentences, 2);
    this.fallbackSentences += fresh.length;
    if (this.fallbackSentences >= 2) this.mode = 'done';
    return fresh.map((x) => `${x.trim()} `).join('');
  }

  /** Remaining speakable text at the end of the reply. */
  end(): string {
    if (this.mode === 'inside') {
      const rest = this.raw.slice(this.emitted).replace(/<\/?s(p(o(k(e(n)?)?)?)?)?>?$/, '');
      this.mode = 'done';
      return rest;
    }
    if (this.mode === 'fallback' && this.fallbackSentences < 2) {
      const all = (stripMarkdown(this.raw).match(/[^.!?]+(?:[.!?]+|$)/g) ?? [])
        .map((x) => x.trim())
        .filter(Boolean);
      const rest = all.slice(this.fallbackSentences, 2).join(' ');
      this.mode = 'done';
      return rest.length > 300 ? `${rest.slice(0, 300)}…` : rest;
    }
    if (this.mode === 'pending') {
      this.mode = 'done';
      return '<spoken>'.startsWith(this.raw.trim()) ? '' : stripMarkdown(this.raw);
    }
    return '';
  }
}

/** Escapes text for the SSML template used by Edge TTS. */
export function escapeSsml(text: string): string {
  return text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string,
  );
}
