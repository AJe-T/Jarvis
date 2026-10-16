import { describe, expect, it } from 'vitest';
import { createLaya, SKIP_JUDGE_BELOW } from '@main/laya/laya';
import { logger } from '@main/logging/logger';

/**
 * ADR-027 check with the real Laya model on CPU. Skipped unless JARVIS_LAYA_MODEL points at the
 * installed folder, e.g.
 *   $env:JARVIS_LAYA_MODEL="$env:APPDATA\Jarvis\models\laya-multilingual"; npx vitest run tests/integration/laya.real.test.ts
 * The rule that matters: no phrase meant for Jarvis may fall under the skip line.
 */
const DIR = process.env['JARVIS_LAYA_MODEL'] ?? '';

const FOR_JARVIS: Array<[string, string?]> = [
  ['Jarvis, open notepad'],
  ['Hey Jarvis, remind me to call mom at 6'],
  ['Jarvis, I just ate a burger'],
  ['జార్విస్, రేపు వాతావరణం ఎలా ఉంటుంది?'],
  ['जार्विस, कल का मौसम कैसा रहेगा?'],
  ['Jarvis, what do you think?'],
  ['Jarvis?'],
  ['yes please', 'Shall I set a timer for ten minutes?'],
  ['and what about tomorrow?', 'It is 31 degrees and sunny in Hyderabad today.'],
  ['make it 20 minutes instead', 'Timer set for ten minutes.'],
];
const NOT_FOR_JARVIS: Array<[string, string?]> = [
  ['I asked Jarvis yesterday and he said no'],
  ['Did you tell Jarvis about the party? I think he forgot'],
  ['My brother says Jarvis can not even tell jokes'],
  ['Rahul call me back when you are free', 'Reminder saved.'],
];

describe.skipIf(!DIR)('Laya on the real model', () => {
  const laya = createLaya({ modelDir: DIR, mode: () => 'on', logger });
  const score = async ([heard, lastReply]: [string, string?]): Promise<number> => {
    for (let i = 0; i < 100; i++) {
      const p = await laya.addressed({ followUp: !!lastReply, lastReply: lastReply ?? '', heard });
      if (p !== null) return p;
      await new Promise((r) => setTimeout(r, 200)); // still loading
    }
    throw new Error('Laya did not load');
  };

  it('never drops a phrase meant for Jarvis', { timeout: 120_000 }, async () => {
    for (const c of FOR_JARVIS)
      expect(await score(c), c[0]).toBeGreaterThanOrEqual(SKIP_JUDGE_BELOW);
  });

  // 2026-10-10: 0.39, 0.16, 0.29, 0.11 — "I asked Jarvis yesterday" still reaches Claude.
  it('drops most chatter about Jarvis', { timeout: 120_000 }, async () => {
    let dropped = 0;
    for (const c of NOT_FOR_JARVIS) if ((await score(c)) < SKIP_JUDGE_BELOW) dropped++;
    expect(dropped).toBeGreaterThanOrEqual(3);
  });
});
