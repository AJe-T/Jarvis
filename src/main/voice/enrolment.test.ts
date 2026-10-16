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
});
