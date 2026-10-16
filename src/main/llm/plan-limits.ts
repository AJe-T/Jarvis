/**
 * Claude plan usage windows (idea from ethanplusai/jarvis's Usage tab). Claude Code reports them on
 * every subscription request as an SDK `rate_limit_event`; Jarvis keeps only the latest numbers in
 * memory. Nothing is fetched and no credentials are read (ADR-010).
 */
export interface PlanWindow {
  /** 0–100. */
  usedPercent: number;
  /** Epoch ms, or null when Claude Code didn't say. */
  resetsAt: number | null;
}

export interface PlanLimits {
  fiveHour: PlanWindow | null;
  sevenDay: PlanWindow | null;
  /** Epoch ms when Claude Code last reported. */
  updatedAt: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toWindow(raw: unknown): PlanWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const used = num(r['utilization']);
  if (used === null) return null;
  const resets = num(r['resetsAt']);
  return {
    usedPercent: Math.max(0, Math.min(100, used * 100)),
    resetsAt: resets === null ? null : resets * 1000,
  };
}

/**
 * Reads `rate_limit_info`. Claude Code 2.x sends `unifiedWindows.{five_hour,seven_day}` with
 * utilization as a 0–1 fraction (seen on a live call, not yet in the SDK's types); the typed
 * `rateLimitType` + `utilization` pair is the fallback. Unknown shapes return null.
 */
export function parsePlanLimits(info: unknown, now: number): PlanLimits | null {
  if (!info || typeof info !== 'object') return null;
  const i = info as Record<string, unknown>;
  const unified = i['unifiedWindows'];
  if (unified && typeof unified === 'object') {
    const u = unified as Record<string, unknown>;
    const fiveHour = toWindow(u['five_hour']);
    const sevenDay = toWindow(u['seven_day']);
    if (fiveHour || sevenDay) return { fiveHour, sevenDay, updatedAt: now };
  }
  const single = toWindow(i);
  if (!single) return null;
  if (i['rateLimitType'] === 'five_hour')
    return { fiveHour: single, sevenDay: null, updatedAt: now };
  if (i['rateLimitType'] === 'seven_day')
    return { fiveHour: null, sevenDay: single, updatedAt: now };
  return null;
}

/** Latest reading; a report that only covers one window keeps the other one. */
export function createPlanLimitsStore(now: () => number = Date.now) {
  let latest: PlanLimits | null = null;
  return {
    record(info: unknown): void {
      const next = parsePlanLimits(info, now());
      if (!next) return;
      latest = {
        fiveHour: next.fiveHour ?? latest?.fiveHour ?? null,
        sevenDay: next.sevenDay ?? latest?.sevenDay ?? null,
        updatedAt: next.updatedAt,
      };
    },
    /** A window whose reset time has passed is no longer known, so it is dropped. */
    get(): PlanLimits | null {
      if (!latest) return null;
      const t = now();
      const fresh = (w: PlanWindow | null): PlanWindow | null =>
        w && (w.resetsAt === null || w.resetsAt > t) ? w : null;
      const fiveHour = fresh(latest.fiveHour);
      const sevenDay = fresh(latest.sevenDay);
      return fiveHour || sevenDay ? { ...latest, fiveHour, sevenDay } : null;
    },
  };
}

/** "5-hour window 62% used (resets 6:00 pm); week 84% used (resets Sun 8:00 am)". */
export function describePlanLimits(p: PlanLimits | null): string {
  if (!p)
    return "No plan usage yet: Claude Code reports it after Jarvis's next reply through the subscription.";
  const time = (ms: number | null, withDay: boolean): string =>
    ms === null
      ? ''
      : ` (resets ${new Date(ms).toLocaleString('en-GB', {
          ...(withDay ? { weekday: 'short' } : {}),
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })})`;
  const parts = [
    p.fiveHour &&
      `5-hour window ${Math.round(p.fiveHour.usedPercent)}% used${time(p.fiveHour.resetsAt, false)}`,
    p.sevenDay &&
      `week ${Math.round(p.sevenDay.usedPercent)}% used${time(p.sevenDay.resetsAt, true)}`,
  ].filter(Boolean);
  return parts.length ? `Claude plan: ${parts.join('; ')}.` : 'Claude plan usage is unavailable.';
}
