import { describe, expect, it } from 'vitest';
import { createEchoCheck, type EchoState } from './echo-check';

function setup() {
  const changes: EchoState[] = [];
  const check = createEchoCheck((s) => changes.push(s));
  let now = 0;
  /** `ms` of mic frames (32 ms each) at `rms`, with or without Jarvis speaking. */
  const feed = (ms: number, rms: number, speaking: boolean) => {
    for (const end = now + ms; now < end; now += 32) check.frame(rms, speaking, now);
  };
  const reply = (rms: number, ms = 1500) => {
    feed(1000, 0.01, false); // the room before he speaks
    feed(ms, rms, true);
    feed(100, 0.01, false); // he stopped: the reply is judged
  };
  return { check, changes, feed, reply };
}

describe('echo cancellation check (voice fix 2A)', () => {
  it('is off without echo cancellation and unverified until replies are judged', () => {
    const t = setup();
    expect(t.check.state()).toBe('off');
    t.reply(0.2);
    expect(t.check.state()).toBe('off'); // nothing judged while off
    t.check.restart(true);
    expect(t.check.state()).toBe('unverified');
  });

  it('two replies at the room level verify it', () => {
    const t = setup();
    t.check.restart(true);
    t.reply(0.011);
    expect(t.check.state()).toBe('unverified');
    t.reply(0.009);
    expect(t.check.state()).toBe('verified');
  });

  it('his voice clearly louder than the room in two of three replies is a leak', () => {
    const t = setup();
    t.check.restart(true);
    t.reply(0.011);
    t.reply(0.05); // +14 dB over the room
    t.reply(0.04);
    expect(t.changes).toEqual(['unverified', 'leaks']);
  });

  it('a reply too short to judge, or one Sir talked over, gives no verdict', () => {
    const t = setup();
    t.check.restart(true);
    t.reply(0.05, 600);
    t.feed(1000, 0.01, false);
    t.feed(800, 0.05, true);
    t.check.skipReply(); // Sir started talking
    t.feed(100, 0.01, false);
    expect(t.check.state()).toBe('unverified');
  });

  it('a changed microphone is checked again from the start', () => {
    const t = setup();
    t.check.restart(true);
    t.reply(0.01);
    t.reply(0.01);
    expect(t.check.state()).toBe('verified');
    t.check.restart(true);
    expect(t.check.state()).toBe('unverified');
  });
});
