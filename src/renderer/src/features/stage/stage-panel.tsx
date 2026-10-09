import { useEffect, useState } from 'react';
import { CheckSquare, Pause, Play, RotateCcw, Square, X } from 'lucide-react';
import clsx from 'clsx';
import type { StagePanel } from '@shared/stage';
import { Markdown } from '../../components/jarvis/chat-message';
import { Button, IconButton } from '../../components/ui/button';
import { call } from '../../lib/api';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { useSpacesStore } from '../../stores/spaces-store';
import { useStageStore } from '../../stores/stage-store';
import { useUiStore } from '../../stores/ui-store';
import { UsagePanel } from '../activity/usage-panel';
import {
  addMinutes,
  clock,
  nextPhase,
  pauseTimer,
  remaining,
  startTimer,
  type Timer,
} from './pomodoro';

const TITLES: Record<StagePanel['kind'], string> = {
  pomodoro: 'Pomodoro',
  usage: 'AI usage & billing',
  status: 'System status',
  list: 'List',
  stats: 'Stats',
  note: 'Note',
};

function Meter({ percent }: { percent: number }): React.JSX.Element {
  return (
    <span className="mt-1.5 block h-1 overflow-hidden rounded-pill bg-surface-2" aria-hidden>
      <span
        className={clsx(
          'block h-full rounded-pill transition-[width] duration-500',
          percent >= 100 ? 'bg-alarm-fill' : percent >= 80 ? 'bg-lamp-400' : 'bg-accent-500',
        )}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </span>
  );
}

function StatGrid({
  stats,
}: {
  stats: Array<{
    label: string;
    value: string;
    hint?: string | undefined;
    percent?: number | undefined;
  }>;
}): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="inset px-3 py-2.5">
          <dt className="hud-label">{s.label}</dt>
          <dd className="mt-0.5 font-code text-lg text-ink-100 tabular">{s.value}</dd>
          {s.hint && <dd className="text-xs text-ink-500">{s.hint}</dd>}
          {s.percent !== undefined && <Meter percent={s.percent} />}
        </div>
      ))}
    </dl>
  );
}

const R = 88;
const CIRC = 2 * Math.PI * R;

function Pomodoro({
  minutes,
  breakMinutes,
  label,
}: Extract<StagePanel, { kind: 'pomodoro' }>): React.JSX.Element {
  const [timer, setTimer] = useState<Timer>(() =>
    startTimer({ phase: 'focus', remainingMs: minutes * 60_000, endsAt: null }, Date.now()),
  );
  const [now, setNow] = useState(Date.now);
  const toast = useUiStore((s) => s.toast);
  const left = remaining(timer, now);
  const total = (timer.phase === 'focus' ? minutes : breakMinutes) * 60_000;

  useEffect(() => {
    if (!timer.endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [timer.endsAt]);

  useEffect(() => {
    if (!timer.endsAt || left > 0) return;
    toast({
      level: 'info',
      message:
        timer.phase === 'focus' ? 'Focus block done, sir. Take a break.' : 'Break over, sir.',
    });
    setTimer(nextPhase(timer, minutes, breakMinutes, Date.now()));
  }, [left, timer, minutes, breakMinutes, toast]);

  const running = timer.endsAt !== null;
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      {label && <p className="text-center text-ink-300">{label}</p>}
      <div className="relative size-52">
        <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke={timer.phase === 'focus' ? 'var(--accent-500)' : 'var(--ok-400)'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - left / Math.max(1, total))}
            style={{ filter: 'drop-shadow(0 0 6px var(--accent-glow))' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="hud-label">{timer.phase === 'focus' ? 'focus' : 'break'}</span>
          <span className="font-code text-5xl text-ink-100 tabular" role="timer" aria-live="off">
            {clock(left)}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() =>
            setTimer(running ? pauseTimer(timer, Date.now()) : startTimer(timer, Date.now()))
          }
        >
          {running ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          {running ? 'Pause' : 'Start'}
        </Button>
        <Button onClick={() => setTimer(addMinutes(timer, 5))}>+5 min</Button>
        <IconButton
          label="Reset timer"
          onClick={() => setTimer({ phase: 'focus', remainingMs: minutes * 60_000, endsAt: null })}
        >
          <RotateCcw size={16} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

const VOICE = {
  off: 'Off',
  ptt: 'Press to talk',
  wake: 'Wake word',
  ambient: 'Always on',
} as const;

/** Jarvis's own dashboard: everything here is read live from the app. */
function Status(): React.JSX.Element {
  const provider = useSetting('llm.provider') ?? 'api';
  const lastModel = useSettingsStore((s) => s.lastModel);
  const defaultModel = useSetting('models.default');
  const model = lastModel ?? defaultModel ?? '—';
  const voice = useSetting('voice.mode') ?? 'off';
  const day = useSettingsStore((s) => s.dayCostUsd);
  const month = useSettingsStore((s) => s.monthCostUsd);
  const dayBudget = useSetting('budget.dailyUsd') ?? 0;
  const monthBudget = useSetting('budget.monthlyUsd') ?? 0;
  const online = useUiStore((s) => s.online);
  const spaces = useSpacesStore((s) => s.spaces);
  const [mcp, setMcp] = useState({ ready: 0, total: 0 });
  const [version, setVersion] = useState('');
  useEffect(() => {
    void call('mcp:list', {}).then((l) =>
      setMcp({ ready: l.filter((s) => s.status === 'ready').length, total: l.length }),
    );
    void call('app:info', {}).then((i) => setVersion(i.version));
  }, []);
  const pct = (a: number, b: number): number | undefined => (b > 0 ? (a / b) * 100 : undefined);
  return (
    <StatGrid
      stats={[
        { label: 'uplink', value: online ? 'Online' : 'Offline', hint: `v${version}` },
        {
          label: 'brain',
          value:
            provider === 'api' ? 'API key' : provider === 'subscription' ? 'Subscription' : 'Local',
          hint: model,
        },
        { label: 'voice', value: VOICE[voice] },
        { label: 'connections', value: `${mcp.ready} / ${mcp.total}`, hint: 'MCP servers ready' },
        {
          label: 'today',
          value: `$${day.toFixed(2)}`,
          hint: `of $${dayBudget.toFixed(2)}`,
          percent: pct(day, dayBudget),
        },
        {
          label: 'this month',
          value: `$${month.toFixed(2)}`,
          hint: `of $${monthBudget.toFixed(2)}`,
          percent: pct(month, monthBudget),
        },
        {
          label: 'spaces',
          value: String(spaces.length),
          hint: `${spaces.reduce((n, s) => n + s.pageCount, 0)} pages`,
        },
      ]}
    />
  );
}

function Body({ panel }: { panel: StagePanel }): React.JSX.Element {
  switch (panel.kind) {
    case 'pomodoro':
      return <Pomodoro {...panel} />;
    case 'usage':
      return <UsagePanel />;
    case 'status':
      return <Status />;
    case 'stats':
      return <StatGrid stats={panel.stats} />;
    case 'note':
      return <Markdown text={panel.markdown} />;
    case 'list':
      return (
        <ul className="flex flex-col gap-1.5">
          {panel.items.map((it, i) => (
            <li key={i} className="inset flex items-start gap-2.5 px-3 py-2">
              {it.done === undefined ? (
                <span className="mt-1.5 size-1.5 shrink-0 bg-accent-500" aria-hidden />
              ) : it.done ? (
                <CheckSquare size={16} className="mt-0.5 shrink-0 text-ok-400" aria-label="Done" />
              ) : (
                <Square
                  size={16}
                  className="mt-0.5 shrink-0 text-icon-rest"
                  aria-label="Not done"
                />
              )}
              <span className="min-w-0">
                <span
                  className={clsx('block text-ink-100', it.done && 'text-ink-500 line-through')}
                >
                  {it.text}
                </span>
                {it.detail && <span className="block text-xs text-ink-500">{it.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

/** The framed panel Jarvis shows beside the orb (Design-system.md §5.2a). */
export function StagePanelFrame({ panel }: { panel: StagePanel }): React.JSX.Element {
  const serial = useStageStore((s) => s.serial);
  const close = (): void => useStageStore.getState().show(null);
  const title = 'title' in panel ? panel.title : TITLES[panel.kind];
  return (
    <section
      aria-label={title}
      className="hud-frame stage-in flex max-h-full min-h-0 w-full flex-col shadow-pop"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <span
          className="size-1.5 shrink-0 bg-accent-500 shadow-[0_0_8px_var(--accent-glow)]"
          aria-hidden
        />
        <h2 className="hud-label truncate text-ink-100!">{`// ${title}`}</h2>
        <IconButton label="Close panel" className="ml-auto" onClick={close}>
          <X size={16} aria-hidden />
        </IconButton>
      </header>
      <div key={serial} className="min-h-0 flex-1 overflow-y-auto p-4">
        <Body panel={panel} />
      </div>
    </section>
  );
}
