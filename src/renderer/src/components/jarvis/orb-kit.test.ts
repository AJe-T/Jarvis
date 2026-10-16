import { describe, expect, it } from 'vitest';
import { moodFor, moodGain, toneFor, type OrbFrame, type Palette } from './orb-kit';

const P: Palette = {
  main: [0, 240, 255],
  deep: [0, 20, 28],
  hi: [234, 253, 255],
  alt: [122, 92, 255],
  mark: [252, 238, 10],
  lamp: [252, 238, 10],
  alarm: [255, 77, 109],
  dim: [125, 147, 168],
  light: false,
};
const frame = (over: Partial<OrbFrame>): OrbFrame => ({
  state: 'IDLE',
  level: 0,
  steps: [],
  ...over,
});

describe('orb mood', () => {
  it('tints the everyday states toward the mood colour', () => {
    const happy = toneFor('SPEAKING', P, moodFor(frame({ state: 'SPEAKING', mood: 'happy' })));
    expect(happy).not.toEqual(P.main);
    expect(happy[0]).toBeGreaterThan(P.main[0]);
  });

  it('never recolours warnings, errors or sleep', () => {
    expect(moodFor(frame({ state: 'AWAITING_CONFIRMATION', mood: 'happy' }))).toBeNull();
    expect(toneFor('ERROR', P, 'happy')).toEqual(P.alarm);
    expect(toneFor('AWAITING_CONFIRMATION', P, 'amused')).toEqual(P.lamp);
  });

  it('calm keeps the accent and slows the orb; excited speeds it up', () => {
    expect(toneFor('IDLE', P, 'calm')).toEqual(P.main);
    expect(moodGain(frame({ mood: 'calm' }))).toBeLessThan(1);
    expect(moodGain(frame({ mood: 'excited' }))).toBeGreaterThan(1);
    expect(moodGain(frame({}))).toBe(1);
  });
});
