import { describe, expect, it } from 'vitest';
import { createAutomation } from '@main/automation/automation';
import { parseFeed, parseFeedList } from '@main/automation/feeds';
import { describeSchedule, nextRun } from '@main/automation/tasks';
import { idle, setupServices } from './helpers';

describe('schedules', () => {
  it('daily: next matching day and time, local time', () => {
    const wed = new Date(2026, 9, 7, 8, 0); // Wed 7 Oct 2026 08:00
    expect(nextRun({ type: 'daily', time: '07:30', days: [] }, wed)).toEqual(
      new Date(2026, 9, 8, 7, 30),
    );
    expect(nextRun({ type: 'daily', time: '09:00', days: [] }, wed)).toEqual(
      new Date(2026, 9, 7, 9, 0),
    );
    expect(nextRun({ type: 'daily', time: '17:00', days: [5] }, wed)).toEqual(
      new Date(2026, 9, 9, 17, 0),
    );
    expect(nextRun({ type: 'interval', minutes: 90 }, wed)).toEqual(new Date(2026, 9, 7, 9, 30));
    expect(describeSchedule({ type: 'daily', time: '07:30', days: [1, 2, 3, 4, 5] })).toBe(
      'weekdays at 07:30',
    );
    expect(describeSchedule({ type: 'interval', minutes: 120 })).toBe('every 2 h');
  });
});

describe('feeds', () => {
  it('parses RSS and Atom, decoding entities and CDATA', () => {
    const rss = `<rss><channel><item><title><![CDATA[Rust &amp; Go]]></title><link>https://a.example/1</link><pubDate>Tue</pubDate></item>
      <item><title>Second &#39;one&#39;</title><link>https://a.example/2</link></item></channel></rss>`;
    expect(parseFeed(rss)).toEqual([
      { title: 'Rust & Go', link: 'https://a.example/1', published: 'Tue' },
      { title: "Second 'one'", link: 'https://a.example/2' },
    ]);
    const atom = `<feed><entry><title>Atom post</title><link href="https://b.example/x"/><updated>2026</updated></entry></feed>`;
    expect(parseFeed(atom)).toEqual([
      { title: 'Atom post', link: 'https://b.example/x', published: '2026' },
    ]);
    expect(
      parseFeedList('# c\nHN | https://hnrss.org/frontpage\nbad line\nhttps://x.example/rss'),
    ).toEqual([
      { name: 'HN', url: 'https://hnrss.org/frontpage' },
      { name: 'https://x.example/rss', url: 'https://x.example/rss' },
    ]);
  });
});

describe('scheduled agents (ideas from OpenJarvis)', () => {
  function setup(rules: Parameters<typeof setupServices>[0], at = new Date()) {
    const t = setupServices(rules, {
      fetch: async () =>
        new Response(
          '<rss><item><title>Big news</title><link>https://n.example/1</link></item></rss>',
        ),
    });
    const notes: Array<{ rel: string; md: string }> = [];
    let clock = at;
    const a = createAutomation(t.services, {
      writeNote: async (rel, md) => notes.push({ rel, md }),
      now: () => clock,
    });
    return { ...t, a, notes, setClock: (d: Date) => (clock = d) };
  }

  it('runs a due briefing as its own turn, saves it to the vault and records its purpose', async () => {
    const t = setup({
      rules: [
        {
          match: 'Scheduled "Morning briefing"',
          steps: [
            { tools: [{ name: 'read_feed', input: {} }] },
            { text: 'Good morning, sir. Big news today.' },
          ],
        },
      ],
    });
    const task = t.a.repo.upsert({
      name: 'Morning briefing',
      kind: 'briefing',
      prompt: 'Brief me.',
      schedule: { type: 'daily', time: '07:30', days: [] },
      saveToVault: true,
    });
    t.services.db
      .prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), task.id);
    t.a.tick();
    await idle(t.services);
    await new Promise((r) => setTimeout(r, 50));
    const row = t.a.repo.get(task.id);
    expect(row?.last_status).toBe('done');
    expect(new Date(row?.next_run_at ?? 0).getTime()).toBeGreaterThan(Date.now());
    expect(t.notes[0]?.rel).toMatch(/^Briefings\/\d{4}-\d{2}-\d{2} Morning briefing\.md$/);
    expect(t.notes[0]?.md).toContain('Big news today');
    const purposes = t.services.db
      .prepare('SELECT DISTINCT purpose FROM usage_ledger')
      .all() as Array<{ purpose: string }>;
    expect(purposes.map((p) => p.purpose)).toContain('briefing');
    const feed = t.services.toolCalls.list(5).find((r) => r.tool_name === 'read_feed');
    expect(feed?.output_preview).toContain('Big news');
  });

  it('a check-in with nothing to say stays silent and leaves no conversation', async () => {
    const t = setup({ rules: [{ match: 'Scheduled "Hydration"', steps: [{ text: 'NOTHING' }] }] });
    const task = t.a.repo.upsert({
      name: 'Hydration',
      kind: 'checkin',
      prompt: 'Nudge me if needed.',
      schedule: { type: 'interval', minutes: 60 },
    });
    const conv = t.a.runNow(task.id);
    await idle(t.services);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.a.repo.get(task.id)?.last_status).toBe('nothing to report');
    expect(t.services.conversations.get(conv ?? '')).toBeUndefined();
  });

  it('skips a run missed by more than two hours instead of running it late', () => {
    const t = setup({ rules: [] });
    const task = t.a.repo.upsert({
      name: 'Old',
      kind: 'task',
      prompt: 'Do it.',
      schedule: { type: 'daily', time: '07:30', days: [] },
    });
    t.services.db
      .prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 5 * 3_600_000).toISOString(), task.id);
    t.a.tick();
    expect(t.a.repo.get(task.id)?.last_status).toMatch(/missed/);
    expect(t.services.orchestrator.isBusy()).toBe(false);
  });

  it('Jarvis can schedule a task when Sir asks (with confirmation)', async () => {
    const t = setup({
      rules: [
        {
          match: 'every friday',
          steps: [
            {
              tools: [
                {
                  name: 'schedule_task',
                  input: {
                    name: 'Weekly review',
                    prompt: 'Summarise my week from my daily logs.',
                    kind: 'task',
                    schedule: { type: 'daily', time: '17:00', days: [5] },
                  },
                },
              ],
            },
            { text: 'Scheduled, sir.' },
          ],
        },
      ],
    });
    const asked: string[] = [];
    t.services.confirmShowListeners.add((e) => {
      asked.push(e.title);
      t.services.broker.respond(e.requestId, 'approve', 'click');
    });
    t.services.orchestrator.send({ text: 'every friday at 5 summarise my week', source: 'text' });
    await idle(t.services);
    expect(asked).toEqual(['Run "Weekly review" Fri at 17:00?']);
    expect(t.a.repo.list().map((x) => x.name)).toContain('Weekly review');
  });

  it('ships a switched-off morning briefing preset once', () => {
    const t = setup({ rules: [] });
    t.a.ensureMorningBriefing();
    t.a.ensureMorningBriefing();
    const briefings = t.a.repo.list().filter((x) => x.kind === 'briefing');
    expect(briefings).toHaveLength(1);
    expect(briefings[0]).toMatchObject({
      enabled: 0,
      speak: 1,
      save_to_vault: 1,
      next_run_at: null,
    });
  });
});
