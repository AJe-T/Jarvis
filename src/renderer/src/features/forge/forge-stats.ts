/**
 * Forge F11: the numbers behind the Forge charts, from the saved runs (`forge:runs`). Pure functions so
 * they are tested without a browser. Weeks start on Monday, local time.
 */

export interface RunLike {
  id: string;
  startedAt: number;
  endedAt: number | null;
  state: string;
  costUsd: number;
  checks: Array<{ id: string; ok: boolean }>;
  freeEdits: number;
  claudeEdits: number;
  ship: { state: string; version: string | null } | null;
}

export interface Week {
  /** Monday 00:00 of the week (ms). */
  start: number;
  label: string;
  cost: number;
  passed: number;
  failed: number;
  cancelled: number;
  shipped: number;
}

const DAY = 86_400_000;

export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  // getDay: 0 = Sunday … 6 = Saturday; Monday starts the week.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.getTime();
}

const label = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The last `weeks` weeks (oldest first, empty weeks included), up to the one holding `now`. */
export function weekly(runs: RunLike[], weeks: number, now: number): Week[] {
  const last = weekStart(now);
  const out: Week[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    // Step back by days, then snap: daylight-saving weeks are not exactly 7 × 24 h.
    const start = weekStart(last - i * 7 * DAY + DAY / 2);
    out.push({
      start,
      label: label(start),
      cost: 0,
      passed: 0,
      failed: 0,
      cancelled: 0,
      shipped: 0,
    });
  }
  const byStart = new Map(out.map((w) => [w.start, w]));
  for (const r of runs) {
    const w = byStart.get(weekStart(r.startedAt));
    if (!w) continue;
    w.cost += Number.isFinite(r.costUsd) ? r.costUsd : 0;
    if (r.state === 'passed') w.passed++;
    else if (r.state === 'failed') w.failed++;
    else if (r.state === 'cancelled') w.cancelled++;
    if (r.ship?.state === 'shipped') w.shipped++;
  }
  return out;
}

/**
 * Which check stops runs: the first failing check of each failed run (the gates stop at the first
 * failure), with how often each check ran at all. Most failures first.
 */
export function gateFailures(runs: RunLike[]): Array<{ id: string; failed: number; ran: number }> {
  const stats = new Map<string, { failed: number; ran: number }>();
  for (const r of runs) {
    for (const c of r.checks) {
      const s = stats.get(c.id) ?? { failed: 0, ran: 0 };
      s.ran++;
      stats.set(c.id, s);
    }
    const first = r.checks.find((c) => !c.ok);
    if (first) {
      const s = stats.get(first.id);
      if (s) s.failed++;
    }
  }
  return [...stats.entries()]
    .map(([id, s]) => ({ id, ...s }))
    .filter((s) => s.failed > 0)
    .sort((a, b) => b.failed - a.failed || a.id.localeCompare(b.id));
}

/** Share of handed-off edits free AIs did, per run that handed any off; oldest first, the last `max`. */
export function freeShare(
  runs: RunLike[],
  max = 30,
): Array<{ id: string; at: number; share: number; edits: number }> {
  return runs
    .filter((r) => r.freeEdits + r.claudeEdits > 0)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-max)
    .map((r) => ({
      id: r.id,
      at: r.startedAt,
      edits: r.freeEdits + r.claudeEdits,
      share: r.freeEdits / (r.freeEdits + r.claudeEdits),
    }));
}

/** The headline numbers: runs, how many passed (of those that ended), average cost and minutes. */
export function summary(runs: RunLike[]): {
  runs: number;
  passRate: number | null;
  avgCost: number | null;
  avgMinutes: number | null;
} {
  const ended = runs.filter((r) => r.state === 'passed' || r.state === 'failed');
  const timed = runs.filter((r) => r.endedAt !== null);
  return {
    runs: runs.length,
    passRate: ended.length ? ended.filter((r) => r.state === 'passed').length / ended.length : null,
    avgCost: runs.length ? runs.reduce((n, r) => n + r.costUsd, 0) / runs.length : null,
    avgMinutes: timed.length
      ? timed.reduce((n, r) => n + ((r.endedAt ?? r.startedAt) - r.startedAt), 0) /
        timed.length /
        60_000
      : null,
  };
}

/** A "nice" axis maximum and its tick step (1, 2, 2.5 or 5 × 10^n), so gridlines land on round values. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  // toPrecision drops float noise (0.6000000000000001 → 0.6).
  const round = (n: number): number => Number(n.toPrecision(12));
  return { max: round(Math.ceil(max / step) * step), step: round(step) };
}
