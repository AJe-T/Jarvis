import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatLogLine, tailLog } from './log-tail';

describe('Logs view (idea from isair/jarvis)', () => {
  it('reads the newest rotating file and formats pino lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-logs-'));
    writeFileSync(join(dir, 'jarvis.1.log'), '{"level":30,"time":1,"msg":"old file"}\n');
    const lines = [
      '{"level":30,"time":1791358267314,"module":"voice","finalToFirstAudioMs":7177,"msg":"latency"}',
      'not json',
      '{"level":40,"time":1791358267315,"module":"voice","err":"Session already disposed.","msg":"ambient transcription failed"}',
    ];
    writeFileSync(join(dir, 'jarvis.2.log'), `${lines.join('\n')}\n`);
    const rows = await tailLog(dir, 10);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      time: new Date(1791358267315).toISOString(),
      level: 'warn',
      module: 'voice',
      text: 'ambient transcription failed  err=Session already disposed.',
    });
    expect((await tailLog(dir, 1)).map((r) => r.level)).toEqual(['warn']);
    expect(formatLogLine('{"level":50,"msg":"x","n":{"a":1}}')?.text).toBe('x  n={"a":1}');
    expect(await tailLog(mkdtempSync(join(tmpdir(), 'jarvis-empty-')), 5)).toEqual([]);
  });
});
