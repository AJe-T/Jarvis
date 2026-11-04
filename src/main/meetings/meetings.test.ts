import { describe, expect, it } from 'vitest';
import type { ContinuousTranscriber, HeardSegment } from '../voice/local/continuous';
import { createMeetings, type MeetingDeps } from './meetings';
import {
  dropEcho,
  meetingPath,
  parseSummary,
  toMarkdown,
  toTurns,
  type Segment,
  type Speaker,
} from './transcript';

const seg = (who: Speaker, text: string, start: number, end = start + 1000): Segment => ({
  who,
  text,
  start,
  end,
});

describe('meeting transcript', () => {
  it("drops the call's voice that leaked into the microphone, keeps sir's own words", () => {
    const out = dropEcho([
      seg('them', 'can you send the budget by Friday', 1000, 3000),
      seg('you', 'send the budget by Friday', 1500, 3200), // echo through the speakers
      seg('you', 'yes I will send it tomorrow', 5000, 7000),
    ]);
    expect(out.map((s) => s.text)).toEqual([
      'can you send the budget by Friday',
      'yes I will send it tomorrow',
    ]);
  });

  it('merges close phrases of one speaker into one turn, in time order', () => {
    const turns = toTurns([
      seg('you', 'second part', 3000),
      seg('you', 'first part', 1000),
      seg('them', 'reply', 6000),
      seg('you', 'much later', 20_000),
    ]);
    expect(turns.map((t) => `${t.who}:${t.text}`)).toEqual([
      'you:first part second part',
      'them:reply',
      'you:much later',
    ]);
  });

  it('names the note by date and title without characters Windows refuses', () => {
    const at = new Date(2026, 10, 4, 15, 30).getTime();
    expect(meetingPath(at, 'Q4: plan / budget?')).toBe(
      'Meetings/2026-11-04 1530 Q4 plan budget.md',
    );
    expect(meetingPath(at, '')).toBe('Meetings/2026-11-04 1530.md');
  });

  it('reads the summary JSON even inside a code fence, and refuses anything else', () => {
    const s = parseSummary(
      '```json\n{"title":"Budget","summary":["Ship Friday"],"actions":[{"task":"Send the budget","owner":"You"}]}\n```',
    );
    expect(s?.actions[0]).toEqual({ task: 'Send the budget', owner: 'You' });
    expect(parseSummary('no json here')).toBeNull();
    // A broken list falls back to empty rather than failing the whole summary.
    expect(parseSummary('{"title":"x","summary":"oops","actions":[]}')?.summary).toEqual([]);
  });

  it('writes summary, action items and transcript', () => {
    const md = toMarkdown({
      title: 'Budget',
      startedAt: 0,
      endedAt: 60_000,
      turns: [{ who: 'them', start: 0, text: 'hello' }],
      summary: {
        title: 'Budget',
        summary: ['Ship Friday'],
        actions: [{ task: 'Send it', owner: '' }],
      },
      micOnly: false,
    });
    expect(md).toContain('## Summary\n- Ship Friday');
    expect(md).toContain('## Action items\n- [ ] Send it');
    expect(md).toMatch(/\*\*Them\*\* \(\d\d:\d\d\): hello/);
  });
});

/** Fakes for the window and the two on-device listeners. */
function harness(over: Partial<MeetingDeps> = {}) {
  const handlers = new Map<number, { onSegment(seg: HeardSegment): void }>();
  let frames = 0;
  const notes: Array<{ rel: string; md: string }> = [];
  const tasks: string[] = [];
  let windowClosed = false;
  let track: Parameters<MeetingDeps['openWindow']>[0] | null = null;
  let flushed = 0;
  const deps: MeetingDeps = {
    openWindow: (h) => {
      track = h;
      return { close: () => (windowClosed = true) };
    },
    listen: async (h) => {
      handlers.set(handlers.size, h);
      const t: ContinuousTranscriber = {
        write: () => void frames++,
        reset: () => undefined,
        flush: async () => void flushed++,
        close: () => undefined,
      };
      return t;
    },
    ready: () => true,
    summarize: async () =>
      '{"title":"Budget call","summary":["Ship Friday"],"actions":[{"task":"Send the budget","owner":"You"}]}',
    writeNote: async (rel, md) => void notes.push({ rel, md }),
    exists: (rel) => notes.some((n) => n.rel === rel),
    addTask: (title) => void tasks.push(title),
    addTasks: () => true,
    onAutoStop: () => undefined,
    log: { warn: () => undefined, info: () => undefined },
    now: () => new Date(2026, 10, 4, 10, 0).getTime(),
    ...over,
  };
  return {
    meetings: createMeetings(deps),
    say: (who: Speaker, text: string, start: number) =>
      handlers.get(who === 'you' ? 0 : 1)?.onSegment({ text, start, end: start + 1000 }),
    frame: (who: Speaker) => track?.onFrame(who, new Int16Array(1600)),
    trackState: (who: Speaker, state: 'started' | 'failed') => track?.onTrack(who, state, ''),
    notes,
    tasks,
    frames: () => frames,
    windowClosed: () => windowClosed,
    flushed: () => flushed,
  };
}

describe('meeting recorder (security review)', () => {
  it("adds only sir's own action items to Tasks, marked as heard in a meeting", async () => {
    const added: Array<{ title: string; notes: string }> = [];
    const h = harness({
      summarize: async () =>
        '{"title":"Call","summary":[],"actions":[{"task":"Send the deck","owner":"You"},{"task":"Wire the money","owner":"Them"},{"task":"Book a room","owner":""}]}',
      addTask: (title, notes) => void added.push({ title, notes }),
    });
    await h.meetings.start();
    h.say('them', 'please wire the money', 1000);
    await h.meetings.stop();
    expect(added.map((a) => a.title)).toEqual(['Send the deck', 'Book a room']);
    expect(added[0]?.notes).toContain('outside content');
  });

  it('never writes over an earlier meeting with the same minute and title', async () => {
    const h = harness();
    await h.meetings.start('Sync');
    const first = await h.meetings.stop();
    await h.meetings.start('Sync');
    const second = await h.meetings.stop();
    expect(first.path).toBe('Meetings/2026-11-04 1000 Sync.md');
    expect(second.path).toBe('Meetings/2026-11-04 1000 Sync (2).md');
  });
});

describe('meeting recorder', () => {
  it('records both tracks, then saves the note and adds the action items to Tasks', async () => {
    const h = harness();
    await h.meetings.start();
    h.trackState('you', 'started');
    h.trackState('them', 'started');
    h.frame('you');
    h.frame('them');
    expect(h.frames()).toBe(2);
    h.say('them', 'can we ship on Friday', 1000);
    h.say('you', 'yes Friday works', 4000);
    expect(h.meetings.status()).toMatchObject({ you: 1, them: 1 });
    const r = await h.meetings.stop();
    expect(h.windowClosed()).toBe(true);
    expect(h.flushed()).toBe(2); // every phrase heard is transcribed first
    expect(r.path).toBe('Meetings/2026-11-04 1000 Budget call.md');
    expect(r.micOnly).toBe(false);
    expect(h.notes[0]?.md).toContain('**You**');
    expect(h.tasks).toEqual(['Send the budget']);
    expect(h.meetings.recording()).toBe(false);
  });

  it('refuses to start without on-device speech, or twice', async () => {
    await expect(harness({ ready: () => false }).meetings.start()).rejects.toThrow(/on-device/);
    const h = harness();
    await h.meetings.start();
    await expect(h.meetings.start()).rejects.toThrow(/already/);
  });

  it("still saves when the PC's sound could not be recorded, and when the summary fails", async () => {
    const h = harness({
      summarize: async () => {
        throw new Error('offline');
      },
    });
    await h.meetings.start('Standup');
    h.trackState('them', 'failed');
    h.say('you', 'notes for myself', 1000);
    const r = await h.meetings.stop();
    expect(r.micOnly).toBe(true);
    expect(r.summary).toBeNull();
    expect(r.path).toContain('Standup');
    expect(h.tasks).toEqual([]);
  });
});
