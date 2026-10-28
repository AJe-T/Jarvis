import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Logger } from '../logging/logger';
import { createOverrunMeter, createVoiceDiagnostics, REPORT_MS } from './diagnostics';

function fakeLogger() {
  const lines: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const make = (): Logger =>
    ({
      child: () => make(),
      info: (obj: Record<string, unknown>, msg: string) => lines.push({ level: 'info', obj, msg }),
      warn: (obj: Record<string, unknown>, msg: string) => lines.push({ level: 'warn', obj, msg }),
    }) as unknown as Logger;
  return { logger: make(), lines };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-diag-'));
  dirs.push(dir);
  let t = 1_000_000;
  const { logger, lines } = fakeLogger();
  const diag = createVoiceDiagnostics({ dir, enabled: () => enabled, logger, now: () => t });
  return { diag, dir, lines, advance: (ms: number) => (t += ms) };
}

/** Waits until the one WAV in `dir` exists and its header is patched (after the stream closes). */
async function wavWhenDone(dir: string): Promise<{ name: string; wav: Buffer }> {
  for (let i = 0; i < 100; i++) {
    const [name] = readdirSync(dir);
    const wav = name ? readFileSync(join(dir, name)) : null;
    if (name && wav && wav.length >= 44 && wav.readUInt32LE(40) > 0) return { name, wav };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no finished recording');
}

describe('voice diagnostics (Phase 0)', () => {
  it('records the exact frames as a valid 16 kHz mono WAV', async () => {
    const { diag, dir } = setup();
    const tap = diag.tap('stt');
    tap?.write(Int16Array.from([1, -2, 3]));
    tap?.write(Int16Array.from([32767, -32768]));
    tap?.close();
    const { name, wav } = await wavWhenDone(dir);
    expect(name).toMatch(/-stt-1\.wav$/);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(40)).toBe(10);
    const samples = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + 54));
    expect([...samples]).toEqual([1, -2, 3, 32767, -32768]);
  });

  it('records nothing while voice.debugAudio is off', () => {
    const { diag, dir } = setup(false);
    expect(diag.tap('wake')).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('logs the first dropped frame at once and the rest as a 10 s summary, keeping totals', () => {
    const { diag, lines, advance } = setup(false);
    diag.drop('queue');
    diag.drop('queue', 3);
    advance(REPORT_MS);
    diag.drop('queue');
    diag.drop('overrun', 2);
    expect(diag.totals()).toEqual({ queue: 5, length: 0, early: 0, overrun: 2 });
    const msgs = lines.map((l) => [l.msg, l.obj['reason'], l.obj['frames']]);
    expect(msgs).toEqual([
      ['audio frames dropped', 'queue', 1],
      ['audio frames dropped (10 s summary)', 'queue', 4],
      ['audio frames dropped', 'queue', 1],
      ['audio frames dropped', 'overrun', 2],
    ]);
  });

  it('reports min / avg / max inference time per window', () => {
    const { diag, lines, advance } = setup(false);
    const time = diag.timer('spotter.decode');
    time(2);
    time(4);
    time(9);
    advance(REPORT_MS);
    time(1);
    const report = lines.find((l) => l.msg === 'audio timing');
    expect(report?.obj).toMatchObject({
      label: 'spotter.decode',
      calls: 3,
      minMs: 2,
      avgMs: 5,
      maxMs: 9,
    });
    diag.flush();
    expect(lines.filter((l) => l.msg === 'audio timing').at(-1)?.obj).toMatchObject({ calls: 1 });
  });
});

describe('native recorder overrun meter', () => {
  it('counts audio lost while the loop fell behind, not the backlog it then reads', () => {
    let t = 0;
    const m = createOverrunMeter(512, () => t); // 32 ms per frame
    m.start();
    t += 40;
    expect(m.frame(40)).toBe(0); // first caught-up read sets the latency baseline (8 ms)
    t += 32;
    expect(m.frame(32)).toBe(0);
    // The loop stalls for 1 s elsewhere: the recorder's backlog then comes out instantly.
    t += 1000;
    expect(m.frame(0.1)).toBe(0);
    t += 0.1;
    expect(m.frame(0.1)).toBe(0);
    // Caught up again (the read waits): wall time is 29 frames ahead of the audio read, so lost.
    t += 32;
    expect(m.frame(32)).toBe(29);
    t += 32;
    expect(m.frame(32)).toBe(0); // counted once
  });
});
