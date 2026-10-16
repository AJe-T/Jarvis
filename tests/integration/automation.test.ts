import { describe, expect, it, vi } from 'vitest';
import { MAX_FAILURES, createAutomation } from '@main/automation/automation';
import { parseFeed, parseFeedList } from '@main/automation/feeds';
import { describeSchedule, nextRun } from '@main/automation/tasks';
import { createFakeClaude } from '@main/llm/fake-claude';
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

  it('once, monthly and startup', () => {
    const wed = new Date(2026, 9, 7, 8, 0);
    expect(nextRun({ type: 'once', at: '2026-10-09T18:30' }, wed)).toEqual(
      new Date(2026, 9, 9, 18, 30),
    );
    expect(nextRun({ type: 'once', at: '2026-10-01T09:00' }, wed)).toBeNull(); // passed
    expect(nextRun({ type: 'monthly', day: 7, time: '09:00' }, wed)).toEqual(
      new Date(2026, 9, 7, 9, 0),
    );
    expect(nextRun({ type: 'monthly', day: 1, time: '09:00' }, wed)).toEqual(
      new Date(2026, 10, 1, 9, 0),
    );
    // Day 31 in a 30-day month runs on its last day.
    expect(nextRun({ type: 'monthly', day: 31, time: '09:00' }, new Date(2026, 10, 2))).toEqual(
      new Date(2026, 10, 30, 9, 0),
    );
    expect(nextRun({ type: 'startup', delayMinutes: 5 }, wed)).toBeNull();
    expect(describeSchedule({ type: 'monthly', day: 22, time: '10:00' })).toBe(
      'monthly on the 22nd at 10:00',
    );
    expect(describeSchedule({ type: 'startup', delayMinutes: 0 })).toBe('when Jarvis starts');
  });

  it('runs "when Jarvis starts" automations once after start, and a one-off only once', async () => {
    vi.useFakeTimers();
    try {
      const t = setupServices({ rules: [{ steps: [{ text: 'Two tasks are overdue.' }] }] });
      const a = createAutomation(t.services);
      const boot = a.repo.upsert({
        name: 'Boot check',
        kind: 'task',
        prompt: 'Say what is overdue.',
        schedule: { type: 'startup', delayMinutes: 1 },
      });
      expect(boot.next_run_at).toBeNull();
      a.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(a.repo.get(boot.id)?.last_run_at).toBeNull(); // still waiting out the delay
      await vi.advanceTimersByTimeAsync(25_000);
      expect(a.repo.get(boot.id)?.last_run_at).not.toBeNull();
      a.stop();

      const once = a.repo.upsert({
        name: 'One-off',
        kind: 'task',
        prompt: 'Do it once.',
        schedule: { type: 'once', at: '2099-01-01T09:00' },
      });
      a.runNow(once.id);
      expect(a.repo.get(once.id)?.next_run_at).not.toBeNull(); // still due in 2099
    } finally {
      vi.useRealTimers();
    }
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

  it('tells Sir what the safety layer held back while an automation ran', async () => {
    const t = setup({
      rules: [
        {
          match: 'Scheduled "Cleanup"',
          steps: [
            {
              tools: [
                {
                  name: 'run_powershell',
                  input: {
                    script: 'Set-MpPreference -DisableRealtimeMonitoring $true',
                    purpose: 'speed up the PC',
                  },
                },
              ],
            },
            { text: 'I could not do that.' },
          ],
        },
      ],
    });
    const task = t.a.repo.upsert({
      name: 'Cleanup',
      kind: 'task',
      prompt: 'Tidy up.',
      schedule: { type: 'interval', minutes: 60 },
    });
    t.a.runNow(task.id);
    await idle(t.services);
    await new Promise((r) => setTimeout(r, 50));
    const warn = t.events.find(
      (e) =>
        e.event === 'notify' &&
        /While running "Cleanup"/.test((e.payload as { message: string }).message),
    );
    expect((warn?.payload as { message: string; level: string }).message).toMatch(
      /the safety policy blocked:/,
    );
    expect(t.services.audit.all().some((r) => r.event === 'task.watchdog')).toBe(true);
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

  it('stops a run that goes over the per-run cost cap and pauses the automation', async () => {
    const t = setup({ rules: [{ match: 'Scheduled "Pricey"', steps: [{ text: 'Done, sir.' }] }] });
    t.services.settings.set('budget.automationRunUsd', 0.25);
    const task = t.a.repo.upsert({
      name: 'Pricey',
      kind: 'task',
      prompt: 'Research everything.',
      schedule: { type: 'interval', minutes: 30 },
    });
    const conversationId = t.a.runNow(task.id) ?? '';
    t.services.usageRepo.insert({
      model: 'claude-sonnet-5-5',
      purpose: 'task',
      conversationId,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estCostUsd: 0.3,
    });
    t.a.tick();
    await idle(t.services);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.a.repo.get(task.id)).toMatchObject({ enabled: 0, next_run_at: null });
    expect(t.a.repo.get(task.id)?.last_status).toMatch(
      /^paused: stopped at \$0\.30, over its \$0\.25/,
    );
  });

  it(`pauses an automation after ${MAX_FAILURES} failed runs in a row`, async () => {
    const t = setupServices(
      { rules: [] },
      {
        llm: {
          ...createFakeClaude({ rules: [] }),
          stream: () => Promise.reject(new Error('API is down')),
        },
      },
    );
    const a = createAutomation(t.services);
    const task = a.repo.upsert({
      name: 'Broken',
      kind: 'task',
      prompt: 'Do the broken thing.',
      schedule: { type: 'interval', minutes: 30 },
    });
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect(a.repo.get(task.id)?.enabled).toBe(1);
      a.runNow(task.id);
      await idle(t.services);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(a.repo.get(task.id)).toMatchObject({ enabled: 0, next_run_at: null });
    expect(a.repo.get(task.id)?.last_status).toMatch(/^paused: failed/);
  }, 15_000); // each failed turn shows its error for 1.5 s before the next one starts

  it('a run cancelled while still queued ends as stopped, not stuck on running', async () => {
    const t = setup({ rules: [{ steps: [{ text: 'Working on it, sir.' }] }] });
    const task = t.a.repo.upsert({
      name: 'Queued',
      kind: 'task',
      prompt: 'Wait your turn.',
      schedule: { type: 'interval', minutes: 30 },
    });
    t.services.orchestrator.send({ text: 'Something first', source: 'text' });
    t.a.runNow(task.id);
    t.services.orchestrator.cancel();
    await idle(t.services);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.a.repo.get(task.id)?.last_status).toBe('stopped');
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
