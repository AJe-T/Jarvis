/**
 * Voice fix 2A: is echo cancellation really keeping Jarvis's voice out of the microphone here?
 * Checked on his own replies: the microphone's level while he speaks is compared with the room's
 * level just before. Barely louder = the canceller works (or the speakers are too quiet to matter);
 * clearly louder = his voice reaches the wake word, so interrupting him by voice is not safe.
 * Sir talking over a reply also reads as "louder", which errs on the safe side.
 */
export type EchoState = 'off' | 'unverified' | 'verified' | 'leaks';

/** Replies in a row that must stay quiet before barge-in by voice is trusted. */
export const QUIET_REPLIES_NEEDED = 2;
/** Loud replies among the last LOUD_WINDOW that mark echo cancellation as not working. */
const LOUD_NEEDED = 2;
const LOUD_WINDOW = 3;
/** The canceller needs a moment to adapt to each reply; its first part isn't judged. */
const SETTLE_MS = 400;
/** A reply shorter than this (after settling) says too little to judge. */
const MIN_JUDGED_MS = 800;
/** Mic level while speaking vs the room's: below QUIET_DB is quiet, above LOUD_DB is a leak. */
const QUIET_DB = 3;
const LOUD_DB = 6;
/** Room level is the 20th percentile of this much quiet audio before a reply. */
const ROOM_MS = 3000;
/** A floor for the room level, so a silent room doesn't make tiny levels look loud. */
const MIN_ROOM_RMS = 0.002;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};

export function createEchoCheck(onChange: (state: EchoState) => void) {
  let state: EchoState = 'off';
  let room: Array<{ at: number; rms: number }> = [];
  let reply: { start: number; levels: Array<{ at: number; rms: number }> } | null = null;
  let quietInARow = 0;
  let recent: boolean[] = []; // true = loud

  function set(next: EchoState): void {
    if (next === state) return;
    state = next;
    onChange(next);
  }

  function judge(r: NonNullable<typeof reply>, now: number): void {
    const judged = r.levels.filter((l) => l.at - r.start >= SETTLE_MS).map((l) => l.rms);
    if (now - r.start - SETTLE_MS < MIN_JUDGED_MS || judged.length < 5 || room.length < 5) return;
    const roomRms = Math.max(
      MIN_ROOM_RMS,
      percentile(
        room.map((l) => l.rms),
        0.2,
      ),
    );
    const db = 20 * Math.log10(Math.max(1e-6, percentile(judged, 0.5)) / roomRms);
    if (db > LOUD_DB) {
      quietInARow = 0;
      recent = [...recent, true].slice(-LOUD_WINDOW);
    } else if (db < QUIET_DB) {
      quietInARow++;
      recent = [...recent, false].slice(-LOUD_WINDOW);
    } else return; // in between: no verdict either way
    if (recent.filter(Boolean).length >= LOUD_NEEDED) set('leaks');
    else if (quietInARow >= QUIET_REPLIES_NEEDED) set('verified');
  }

  return {
    state: (): EchoState => state,

    /** The microphone changed: echo-cancelled (check again from scratch) or not (off). */
    restart(echoCancelled: boolean): void {
      room = [];
      reply = null;
      quietInARow = 0;
      recent = [];
      set(echoCancelled ? 'unverified' : 'off');
    },

    /** One microphone frame's level; `speaking` = Jarvis's voice is playing. */
    frame(rms: number, speaking: boolean, now: number): void {
      if (state === 'off') return;
      if (speaking) {
        reply ??= { start: now, levels: [] };
        reply.levels.push({ at: now, rms });
        return;
      }
      if (reply) {
        judge(reply, now);
        reply = null;
        room = []; // the room is measured afresh before the next reply
      }
      room.push({ at: now, rms });
      while (room.length > 0 && now - (room[0]?.at ?? now) > ROOM_MS) room.shift();
    },

    /** Sir (not the speakers) is talking right now: this reply can't be judged. */
    skipReply(): void {
      reply = null;
    },
  };
}
