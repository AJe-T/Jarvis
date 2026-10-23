import { describe, expect, it, vi } from 'vitest';
import { createEnrolment, ENROL_PHRASES, learnAliases } from './enrolment';

const second = new Float32Array(16000);

describe('Voice Match enrolment (ADR-039)', () => {
  it('learns a spelling heard at least twice that the name rules miss', () => {
    expect(
      learnAliases(
        ['Hey some are.', 'hey, some are', 'Hey Summer', 'okay summa', 'hey some are'],
        'Summer',
      ),
    ).toEqual(['some are']);
  });

  it('ignores one-offs, the name itself, long phrases and tiny words', () => {
    expect(learnAliases(['hey zoomer', 'hey summer', 'hey summer'], 'Summer')).toEqual([]);
    expect(learnAliases(['hey what is it now', 'hey what is it now'], 'Summer')).toEqual([]);
    expect(learnAliases(['hey sum', 'hey sum'], 'Summer')).toEqual([]);
  });

  function setup(over: Partial<Parameters<typeof createEnrolment>[0]> = {}) {
    const save = vi.fn();
    const embed = vi.fn(async (a: Float32Array) =>
      Float32Array.from({ length: 64 }, (_, i) => Math.sin(i) + a.length * 0),
    );
    const e = createEnrolment({
      record: async () => second,
      speakerReady: () => true,
      embed,
      transcribe: async () => 'hey some are',
      name: () => 'Summer',
      save,
      now: () => 1,
      ...over,
    });
    return { e, save, embed };
  }

  it('fingerprints each phrase and saves the profile after the fifth', async () => {
    const { e, save, embed } = setup();
    for (let i = 1; i <= ENROL_PHRASES; i++) expect((await e.sample()).count).toBe(i);
    expect(embed).toHaveBeenCalledTimes(ENROL_PHRASES);
    const r = e.finish();
    expect(r.aliases).toEqual(['some are']);
    expect(save).toHaveBeenCalledOnce();
    const [profile] = save.mock.calls[0] as [string];
    expect(JSON.parse(profile)).toMatchObject({ v: 1, model: 'wavlm-speaker', samples: 5 });
    expect(e.count()).toBe(0); // the session is cleared
  });

  it('refuses to finish early, to record without the model, and too-short phrases', async () => {
    const { e } = setup();
    await e.sample();
    expect(() => e.finish()).toThrow('not enough phrases');
    await expect(setup({ speakerReady: () => false }).e.sample()).rejects.toThrow(
      'speaker model not downloaded',
    );
    await expect(setup({ record: async () => new Float32Array(100) }).e.sample()).rejects.toThrow(
      'phrase too short',
    );
  });

  it('still enrols when on-device speech is not there to learn spellings', async () => {
    const { e } = setup({ transcribe: async () => Promise.reject(new Error('no whisper')) });
    for (let i = 0; i < ENROL_PHRASES; i++) await e.sample();
    expect(e.finish().aliases).toEqual([]);
  });

  it('ADR-043: the same phrases become the personal wake word when its model is there', async () => {
    const frame = (k: number): Float32Array => {
      const v = new Float32Array(96).fill(0.01);
      v[k] = 1;
      return v;
    };
    let n = 0;
    const saveWake = vi.fn();
    const { e } = setup({
      wakeFeatures: async () => {
        n++;
        return {
          embeddings: [frame(0), ...[1, 2, 3, 4, 5].map((k) => frame(k + (n % 2))), frame(0)],
          loud: [false, true, true, true, true, true, false],
        };
      },
      saveWake,
    });
    for (let i = 0; i < ENROL_PHRASES; i++) await e.sample();
    expect(e.finish().wakeWord).toBe(true);
    expect(saveWake).toHaveBeenCalledOnce();
    // Without the wake-word model: Voice Match only.
    const plain = setup({ wakeFeatures: async () => null, saveWake: vi.fn() });
    for (let i = 0; i < ENROL_PHRASES; i++) await plain.e.sample();
    expect(plain.e.finish().wakeWord).toBe(false);
  });

  it('ADR-044: calibrates the keyword spotter from the same phrases', async () => {
    const levels = [0.5, 0.35, 0.45, 0.1, 0.4];
    const endCalibration = vi.fn();
    const { e } = setup({ spotterLevel: async () => levels.shift() ?? 0, endCalibration });
    for (let i = 0; i < ENROL_PHRASES; i++) await e.sample();
    expect(e.finish().spotterLevel).toBe(0.35); // the one weak take (0.1) is forgiven
    expect(endCalibration).toHaveBeenCalledOnce();
    // Without the spotter model (or with a phrase it failed on): not calibrated.
    const none = setup({ spotterLevel: async () => null });
    for (let i = 0; i < ENROL_PHRASES; i++) await none.e.sample();
    expect(none.e.finish().spotterLevel).toBe(0);
    let n = 0;
    const mixed = setup({
      spotterLevel: async () => (n++ === 2 ? Promise.reject(new Error('busy')) : 0.4),
    });
    for (let i = 0; i < ENROL_PHRASES; i++) await mixed.e.sample();
    expect(mixed.e.finish().spotterLevel).toBe(0);
  });
});
