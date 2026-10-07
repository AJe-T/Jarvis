import { readdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

/** Read at most this much from the end of the current log. */
const TAIL_BYTES = 256 * 1024;
const LEVELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export interface LogLine {
  time: string;
  level: string;
  module: string;
  text: string;
}

/** pino line → readable row: message plus any extra fields (already redacted by the logger). */
export function formatLogLine(raw: string): LogLine | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { time, level, module, msg, ...rest } = o;
  const extra = Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return {
    time: typeof time === 'number' ? new Date(time).toISOString() : '',
    level: LEVELS[Number(level)] ?? String(level),
    module: typeof module === 'string' ? module : '',
    text: [typeof msg === 'string' ? msg : '', extra].filter(Boolean).join('  '),
  };
}

/** Newest lines of the current rotating log (pino-roll: jarvis.<n>.log, highest n is current). */
export async function tailLog(dir: string, lines: number): Promise<LogLine[]> {
  const current = readdirSync(dir, { withFileTypes: true })
    .map((e) => /^jarvis\.(\d+)\.log$/.exec(e.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0];
  if (!current) return [];
  const fh = await open(join(dir, current), 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const rows = buf.toString('utf8').split('\n');
    if (start > 0) rows.shift(); // first row may be cut in half
    return rows
      .map(formatLogLine)
      .filter((l): l is LogLine => l !== null)
      .slice(-lines);
  } finally {
    await fh.close();
  }
}
