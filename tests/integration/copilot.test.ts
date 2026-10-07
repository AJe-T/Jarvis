import { describe, expect, it } from 'vitest';
import { createCopilot, parseJson, rank, scoreCandidate } from '@main/copilot/copilot';
import { z } from 'zod';
import { setupServices } from './helpers';

const check = (
  o: Partial<{
    hard: string[];
    confirm: string[];
    missing: string[];
    goal: number;
    delivery: number;
  }>,
) =>
  ({ hard: [], confirm: [], missing: [], goal: 5, delivery: 5, note: '', ...o }) as Parameters<
    typeof scoreCandidate
  >[1];

describe('reply copilot scoring (from jev-chat-jarvis)', () => {
  it('S = 0.7 G + 0.3 E, a missing item caps G at 3, hard problems block', () => {
    expect(scoreCandidate('a', check({ goal: 4, delivery: 5 })).score).toBe(4.3);
    expect(
      scoreCandidate('a', check({ goal: 5, delivery: 5, missing: ['the date'] })),
    ).toMatchObject({
      score: 3.6,
      problems: ['Leaves out: the date'],
    });
    expect(scoreCandidate('a', check({ hard: ['new_commitment'] })).state).toBe('blocked');
    expect(scoreCandidate('a', check({ confirm: ['admits_fault'] })).state).toBe('confirm');
  });

  it('Top pick only for a clearly better, clean reply', () => {
    const a = scoreCandidate('a', check({ goal: 5, delivery: 5 }));
    const b = scoreCandidate('b', check({ goal: 4, delivery: 4 }));
    const c = scoreCandidate('c', check({ goal: 5, delivery: 4.9 }));
    expect(rank([b, a]).map((x) => [x.text, x.topPick])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(rank([a, c]).some((x) => x.topPick)).toBe(false); // too close to call
    const blocked = scoreCandidate('x', check({ hard: ['beyond_goal'], goal: 5 }));
    expect(rank([blocked, b])[0]?.text).toBe('b');
  });

  it('parses JSON inside code fences', () => {
    expect(parseJson(z.object({ a: z.number() }), 'Sure:\n```json\n{"a": 1}\n```')).toEqual({
      a: 1,
    });
  });
});

describe('reply copilot end to end', () => {
  it('capture → analyse → draft + check → paste into the same chat, never send', async () => {
    const t = setupServices({
      rules: [
        {
          system: 'transcribe the visible conversation',
          steps: [
            {
              text: '{"app":"WhatsApp","contact":"Priya","isGroup":false,"messages":[{"from":"them","text":"Can you cover my shift on Saturday?"},{"from":"me","text":"hmm let me see"}]}',
            },
          ],
        },
        {
          system: 'Work out the situation BEFORE anyone writes',
          steps: [
            {
              text: '{"theyWant":"You to cover their Saturday shift","tone":"friendly","pressure":"medium","boundaries":[],"friction":[],"options":[{"id":"a","label":"Agree","stance":"Say yes","mustInclude":["yes"],"avoid":[],"needsDetail":null},{"id":"b","label":"Decline kindly","stance":"Say no warmly","mustInclude":["a reason"],"avoid":["promising another day"],"needsDetail":"your reason"}]}',
            },
          ],
        },
        {
          system: 'Write two different replies',
          steps: [
            {
              text: '{"replies":["Sorry, I can\'t this Saturday, family plans!","Wish I could but I\'m busy Saturday 😕"]}',
            },
          ],
        },
        {
          system: 'Check a draft chat reply',
          steps: [
            {
              text: '{"hard":[],"confirm":[],"missing":[],"goal":5,"delivery":4,"note":"Kind and clear."}',
            },
          ],
        },
      ],
    });
    const c = createCopilot(t.services);
    const cap = await c.capture();
    expect(cap.chat.contact).toBe('Priya');
    const screenshot = t.llm.calls[0]?.messages[0]?.content as Array<{ type: string }>;
    expect(screenshot.map((b) => b.type)).toEqual(['text', 'image']);

    const a = await c.analyse(cap.id, 'work', 'peer', false);
    expect(a.options.map((o) => o.id)).toEqual(['a', 'b']);
    const drafts = await c.draft(cap.id, 'b', 'family plans');
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.state === 'eligible' && d.score === 4.7)).toBe(true);
    const draftCall = t.llm.calls.find((x) =>
      JSON.stringify(x.system).includes('Write two different replies'),
    );
    expect(JSON.stringify(draftCall?.system)).toContain("The user's detail: family plans");
    expect(JSON.stringify(draftCall?.system)).toContain('A colleague at my level');

    await c.fill(cap.id, drafts[0]?.text ?? '');
    const os = t.services.os as unknown as { calls: Array<{ op: string; args: unknown[] }> };
    expect(
      os.calls.filter((x) => ['focusWindow', 'pasteText'].includes(x.op)).map((x) => x.op),
    ).toEqual(['focusWindow', 'pasteText']);
    expect(os.calls.some((x) => x.op === 'run' || x.op === 'ps')).toBe(false); // no Enter, no send
    await expect(c.fill(cap.id, 'again')).rejects.toMatchObject({ userMessage: /expired/ });
  });
});
