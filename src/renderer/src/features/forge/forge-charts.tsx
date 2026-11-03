import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { StatTile } from '../router/parts';
import { freeShare, gateFailures, niceScale, summary, weekly, type Week } from './forge-stats';
import './forge.css';

/**
 * Forge F11: charts of Forge over time (Sidebar → Forge → Charts). Hand-drawn SVG, no chart library.
 * Built to the dataviz method: one job per chart (cost = magnitude, outcomes = status, failing
 * checks = ranked magnitude, free share = change over time), a single axis each, thin marks with
 * 4px rounded data-ends and 2px gaps, a hover tooltip on every mark, and a table view of each.
 * Outcome colours are status colours checked with the palette validator for both themes
 * (forge.css); failures also carry a hatch, so they never rely on colour alone.
 */

type Run = Res<'forge:runs'>[number];

const H = 200;
const PAD = { l: 44, r: 8, t: 10, b: 26 };
const PLOT_H = H - PAD.t - PAD.b;

/**
 * Charts draw at their real width (1 SVG unit = 1 CSS pixel), so labels keep their size on any
 * window: the card measures itself and hands the width down.
 */
const WidthCtx = createContext(560);
function useDims(): { W: number; PLOT_W: number } {
  const W = useContext(WidthCtx);
  return { W, PLOT_W: W - PAD.l - PAD.r };
}
function useMeasured(): [(el: HTMLElement | null) => void, number] {
  const [w, setW] = useState(560);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => {
      if (e) setW(Math.max(280, Math.round(e.contentRect.width)));
    });
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w];
}
const WEEKS = 12;

const usd = (n: number): string =>
  n === 0 ? '$0' : n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** A bar from the baseline with its data-end rounded (4px), the baseline end square. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function Card({
  title,
  takeaway,
  table,
  children,
  legend,
}: {
  title: string;
  takeaway: string;
  table: React.ReactNode;
  children: React.ReactNode;
  legend?: React.ReactNode;
}): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="forge-chart card" aria-label={title}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
          <p className="text-xs text-ink-500">{takeaway}</p>
        </div>
        <button
          type="button"
          className="forge-chart-toggle"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Chart' : 'Table'}
        </button>
      </header>
      {legend}
      {showTable ? <div className="forge-chart-table">{table}</div> : children}
    </section>
  );
}

/** Gridlines and y labels for one axis. */
function YAxis({
  max,
  step,
  fmt,
}: {
  max: number;
  step: number;
  fmt(n: number): string;
}): React.JSX.Element {
  const { W } = useDims();
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 1000; v += step) ticks.push(v);
  return (
    <g>
      {ticks.map((v) => {
        const y = PAD.t + PLOT_H - (v / max) * PLOT_H;
        return (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="forge-grid" />
            <text
              x={PAD.l - 6}
              y={y}
              className="forge-tick"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fmt(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ weeks }: { weeks: Week[] }): React.JSX.Element {
  const { PLOT_W } = useDims();
  const band = PLOT_W / weeks.length;
  return (
    <g>
      {weeks.map((w, i) =>
        i % 2 === weeks.length % 2 ? null : (
          <text
            key={w.start}
            x={PAD.l + band * (i + 0.5)}
            y={H - 8}
            className="forge-tick"
            textAnchor="middle"
          >
            {w.label}
          </text>
        ),
      )}
    </g>
  );
}

/** Tooltip positioned over the SVG in percent, so it follows the chart's responsive width. */
function Tip({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const { W } = useDims();
  return (
    <div
      className="forge-tip"
      style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
      role="status"
    >
      {children}
    </div>
  );
}

function CostChart({ weeks }: { weeks: Week[] }): React.JSX.Element {
  const [plotRef, W] = useMeasured();
  const PLOT_W = W - PAD.l - PAD.r;
  const [hover, setHover] = useState<number | null>(null);
  const { max, step } = niceScale(Math.max(...weeks.map((w) => w.cost)));
  const band = PLOT_W / weeks.length;
  const bw = Math.max(4, band - 2 - band * 0.3);
  const total = weeks.reduce((n, w) => n + w.cost, 0);
  const h = hover !== null ? weeks[hover] : undefined;
  return (
    <WidthCtx.Provider value={W}>
      <Card
        title="Claude cost per week"
        takeaway={`${usd(total)} over the last ${weeks.length} weeks (Claude Code's own estimate).`}
        table={
          <table>
            <thead>
              <tr>
                <th>Week of</th>
                <th>Claude cost</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start}>
                  <td>{w.label}</td>
                  <td>{usd(w.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <div ref={plotRef} className="forge-plot">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Claude cost per week, ${usd(total)} in all`}
          >
            <YAxis max={max} step={step} fmt={usd} />
            {weeks.map((w, i) => {
              const bh = (w.cost / max) * PLOT_H;
              const x = PAD.l + band * i + (band - bw) / 2;
              return (
                <g
                  key={w.start}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect
                    x={PAD.l + band * i}
                    y={PAD.t}
                    width={band}
                    height={PLOT_H}
                    className="forge-hit"
                  />
                  <path
                    d={barPath(x, PAD.t + PLOT_H - bh, bw, bh)}
                    className={clsx('forge-bar', hover === i && 'is-hover')}
                  />
                </g>
              );
            })}
            <XLabels weeks={weeks} />
          </svg>
          {h && hover !== null && (
            <Tip x={PAD.l + band * (hover + 0.5)} y={PAD.t + PLOT_H - (h.cost / max) * PLOT_H}>
              <b>Week of {h.label}</b>
              <span>{usd(h.cost)} of Claude</span>
            </Tip>
          )}
        </div>
      </Card>
    </WidthCtx.Provider>
  );
}

const OUTCOMES = [
  { key: 'passed', label: 'Passed', mark: '✓', cls: 'is-pass' },
  { key: 'failed', label: 'Failed', mark: '✗', cls: 'is-fail' },
  { key: 'cancelled', label: 'Cancelled', mark: '–', cls: 'is-cancel' },
] as const;

function OutcomeChart({ weeks }: { weeks: Week[] }): React.JSX.Element {
  const [plotRef, W] = useMeasured();
  const PLOT_W = W - PAD.l - PAD.r;
  const [hover, setHover] = useState<number | null>(null);
  const totals = weeks.map((w) => w.passed + w.failed + w.cancelled);
  const { max, step } = niceScale(Math.max(...totals, 1));
  const band = PLOT_W / weeks.length;
  const bw = Math.max(4, band - 2 - band * 0.3);
  const passed = weeks.reduce((n, w) => n + w.passed, 0);
  const all = totals.reduce((n, t) => n + t, 0);
  const h = hover !== null ? weeks[hover] : undefined;
  return (
    <WidthCtx.Provider value={W}>
      <Card
        title="Runs per week, by outcome"
        takeaway={all ? `${passed} of ${all} runs passed every check.` : 'No runs in these weeks.'}
        legend={
          <ul className="forge-legend" aria-label="Outcomes">
            {OUTCOMES.map((o) => (
              <li key={o.key}>
                <span className={clsx('forge-swatch', o.cls)} aria-hidden />
                <span aria-hidden>{o.mark}</span> {o.label}
              </li>
            ))}
          </ul>
        }
        table={
          <table>
            <thead>
              <tr>
                <th>Week of</th>
                <th>Passed</th>
                <th>Failed</th>
                <th>Cancelled</th>
                <th>Shipped</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start}>
                  <td>{w.label}</td>
                  <td>{w.passed}</td>
                  <td>{w.failed}</td>
                  <td>{w.cancelled}</td>
                  <td>{w.shipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <div ref={plotRef} className="forge-plot">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Runs per week by outcome: ${passed} of ${all} passed`}
          >
            <defs>
              <pattern
                id="forge-hatch"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="6" className="forge-hatch-line" />
              </pattern>
            </defs>
            <YAxis max={max} step={step} fmt={(n) => String(Math.round(n * 100) / 100)} />
            {weeks.map((w, i) => {
              const x = PAD.l + band * i + (band - bw) / 2;
              let y = PAD.t + PLOT_H;
              const segs = OUTCOMES.map((o) => ({ ...o, n: w[o.key] })).filter((s) => s.n > 0);
              return (
                <g
                  key={w.start}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect
                    x={PAD.l + band * i}
                    y={PAD.t}
                    width={band}
                    height={PLOT_H}
                    className="forge-hit"
                  />
                  {segs.map((s, k) => {
                    const sh = (s.n / max) * PLOT_H;
                    // 2px surface gap between stacked segments; only the top one gets the rounded end.
                    const gap = k > 0 ? 2 : 0;
                    y -= sh;
                    const top = k === segs.length - 1;
                    const d = top
                      ? barPath(x, y, bw, sh - gap)
                      : `M${x},${y + sh - gap}V${y}H${x + bw}V${y + sh - gap}Z`;
                    return (
                      <g key={s.key}>
                        <path
                          d={d}
                          className={clsx('forge-seg', s.cls, hover === i && 'is-hover')}
                        />
                        {s.key === 'failed' && <path d={d} fill="url(#forge-hatch)" />}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <XLabels weeks={weeks} />
          </svg>
          {h && hover !== null && (
            <Tip
              x={PAD.l + band * (hover + 0.5)}
              y={PAD.t + PLOT_H - ((h.passed + h.failed + h.cancelled) / max) * PLOT_H}
            >
              <b>Week of {h.label}</b>
              <span>
                ✓ {h.passed} passed · ✗ {h.failed} failed · – {h.cancelled} cancelled
              </span>
              {h.shipped > 0 && <span>{h.shipped} shipped</span>}
            </Tip>
          )}
        </div>
      </Card>
    </WidthCtx.Provider>
  );
}

function GateChart({ runs }: { runs: Run[] }): React.JSX.Element {
  const rows = gateFailures(runs).slice(0, 8);
  const max = Math.max(...rows.map((r) => r.failed), 1);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <Card
      title="Where runs fail"
      takeaway={
        rows[0]
          ? `The ${rows[0].id} check stops the most runs (${rows[0].failed}).`
          : 'No run has failed a check yet.'
      }
      table={
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Runs it stopped</th>
              <th>Times it ran</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.failed}</td>
                <td>{r.ran}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-500">Nothing to show yet.</p>
      ) : (
        <ul className="forge-hbars" aria-label="Runs stopped per check">
          {rows.map((r) => (
            <li
              key={r.id}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              title={`${r.id}: stopped ${r.failed} of the ${r.ran} runs it checked`}
            >
              <span className="forge-hbar-label">{r.id}</span>
              <span className="forge-hbar-track">
                <span
                  className={clsx('forge-hbar', hover === r.id && 'is-hover')}
                  style={{ width: `${(r.failed / max) * 100}%` }}
                />
              </span>
              <span className="forge-hbar-value">{r.failed}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ShareChart({ runs }: { runs: Run[] }): React.JSX.Element {
  const [plotRef, W] = useMeasured();
  const PLOT_W = W - PAD.l - PAD.r;
  const pts = freeShare(runs);
  const [hover, setHover] = useState<number | null>(null);
  const x = (i: number): number =>
    PAD.l + (pts.length < 2 ? PLOT_W / 2 : (i / (pts.length - 1)) * PLOT_W);
  const y = (s: number): number => PAD.t + PLOT_H - s * PLOT_H;
  const avg = pts.length ? pts.reduce((n, p) => n + p.share, 0) / pts.length : 0;
  const p = hover !== null ? pts[hover] : undefined;
  return (
    <WidthCtx.Provider value={W}>
      <Card
        title="Edits done by free AIs"
        takeaway={
          pts.length
            ? `Free AIs did ${pct(avg)} of handed-off edits on average (last ${pts.length} runs).`
            : 'No run has handed edits to free AIs yet.'
        }
        table={
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Started</th>
                <th>Edits</th>
                <th>Free share</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((q) => (
                <tr key={q.id}>
                  <td>{q.id}</td>
                  <td>{new Date(q.at).toLocaleDateString()}</td>
                  <td>{q.edits}</td>
                  <td>{pct(q.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        {pts.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">Nothing to show yet.</p>
        ) : (
          <div ref={plotRef} className="forge-plot">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Free AI share of edits per run, ${pct(avg)} on average`}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const vx = ((e.clientX - box.left) / box.width) * W;
                let best = 0;
                for (let i = 1; i < pts.length; i++)
                  if (Math.abs(x(i) - vx) < Math.abs(x(best) - vx)) best = i;
                setHover(best);
              }}
            >
              <YAxis max={1} step={0.25} fmt={pct} />
              {hover !== null && (
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={PAD.t}
                  y2={PAD.t + PLOT_H}
                  className="forge-cross"
                />
              )}
              <polyline
                points={pts.map((q, i) => `${x(i)},${y(q.share)}`).join(' ')}
                className="forge-line"
              />
              {pts.map((q, i) => (
                <circle
                  key={q.id}
                  cx={x(i)}
                  cy={y(q.share)}
                  r={hover === i ? 5 : 4}
                  className="forge-dot"
                />
              ))}
            </svg>
            {p && hover !== null && (
              <Tip x={x(hover)} y={y(p.share)}>
                <b>{new Date(p.at).toLocaleDateString()}</b>
                <span>
                  {pct(p.share)} of {p.edits} edits done free
                </span>
              </Tip>
            )}
          </div>
        )}
      </Card>
    </WidthCtx.Provider>
  );
}

/** Forge F11: the Charts tab. */
export function ForgeCharts({ runs }: { runs: Run[] }): React.JSX.Element {
  const weeks = useMemo(() => weekly(runs, WEEKS, Date.now()), [runs]);
  const s = summary(runs);
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Forge in numbers" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile label="Runs" value={String(s.runs)} />
        <StatTile
          label="Pass rate"
          value={s.passRate === null ? '—' : pct(s.passRate)}
          hint="of runs that finished"
        />
        <StatTile
          label="Average cost"
          value={s.avgCost === null ? '—' : usd(s.avgCost)}
          hint="Claude, per run"
        />
        <StatTile
          label="Average time"
          value={s.avgMinutes === null ? '—' : `${Math.round(s.avgMinutes)} min`}
        />
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <CostChart weeks={weeks} />
        <OutcomeChart weeks={weeks} />
        <GateChart runs={runs} />
        <ShareChart runs={runs} />
      </div>
    </div>
  );
}
