import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, CircleAlert, CircleX, RefreshCw, Rocket, X } from 'lucide-react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useForgeStore } from '../../stores/forge-store';
import './forge.css';

/**
 * Forge F12: Sir's first real run, guided. Three steps: get ready (a live checklist of what a run
 * needs, each with a fix), build (one click posts a small, safe first request to the Forge desk, which
 * still agrees the goal and asks first), install and try. Shown until a run has passed, or hidden.
 */

type Check = Res<'forge:readiness'>[number];
const HIDE_KEY = 'jarvis.forge.firstRunHidden';

const ICON = {
  ok: <CheckCircle2 size={15} className="shrink-0 text-ok-400" aria-label="Ready" />,
  warn: (
    <CircleAlert size={15} className="shrink-0 text-lamp-400" aria-label="Works, with a note" />
  ),
  missing: <CircleX size={15} className="shrink-0 text-alarm-500" aria-label="Needed" />,
};

function hidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function FirstRun(): React.JSX.Element | null {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [hide, setHide] = useState(hidden);
  const [starting, setStarting] = useState(false);
  const live = useForgeStore((s) => s.live);
  const runsVersion = useForgeStore((s) => s.runsVersion);
  const onMessage = useForgeStore((s) => s.onMessage);

  const check = useCallback(() => {
    setError(null);
    call('forge:readiness', {})
      .then(setChecks)
      .catch((err: unknown) => setError(cleanError(err)));
  }, []);
  useEffect(check, [check]);
  useEffect(() => {
    call('forge:runs', {})
      .then((runs) => setPassed(runs.some((r) => r.state === 'passed')))
      .catch(() => setPassed(false));
  }, [runsVersion]);

  if (hide || passed === null) return null;
  const ready = checks?.every((c) => !c.required || c.state === 'ok') ?? false;
  const building = Boolean(live && !['passed', 'failed', 'cancelled'].includes(live.state));
  const done = passed || live?.state === 'passed';
  // A run that passed ends the guide on step 3; it closes for good once Sir hides it.
  const step = done ? 3 : building ? 2 : ready ? 2 : 1;

  const start = async (): Promise<void> => {
    setStarting(true);
    try {
      onMessage(await call('forge:firstRun', {}));
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section aria-label="Your first Forge run" className="forge-first card flex flex-col gap-3 p-4">
      <header className="flex items-start gap-3">
        <Rocket size={18} className="mt-0.5 shrink-0 text-accent-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink-100">Your first Forge run</h3>
          <p className="text-xs text-ink-500">
            A small, safe first build: a self-built currency tool. It runs sandboxed and needs no
            reinstall.
          </p>
        </div>
        <button
          type="button"
          className="text-ink-500 hover:text-ink-100"
          aria-label="Hide the first-run guide"
          onClick={() => {
            setHide(true);
            try {
              localStorage.setItem(HIDE_KEY, '1');
            } catch {
              // not remembered
            }
          }}
        >
          <X size={15} aria-hidden />
        </button>
      </header>

      <ol className="forge-steps" aria-label="Steps">
        {['Get ready', 'Build', 'Install & try'].map((label, i) => (
          <li
            key={label}
            className={clsx(step > i + 1 && 'is-done', step === i + 1 && 'is-current')}
            aria-current={step === i + 1 ? 'step' : undefined}
          >
            <span aria-hidden>{step > i + 1 ? '✓' : i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {step === 1 || (step === 2 && !building) ? (
        <>
          {error && <p className="text-xs text-alarm-500">{error}</p>}
          {!checks && !error && <span className="skeleton block h-24 w-full" aria-hidden />}
          {checks && (
            <ul className="flex flex-col gap-1.5" aria-label="What Forge needs">
              {checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  {ICON[c.state]}
                  <span className="min-w-0">
                    <span className="text-ink-100">{c.label}</span>
                    <span className="text-ink-500"> · {c.detail}</span>
                    {c.fix && <span className="block text-xs text-ink-300">{c.fix}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!ready || starting} onClick={() => void start()}>
              <Rocket size={14} aria-hidden /> Start my first run
            </Button>
            <Button variant="ghost" onClick={check}>
              <RefreshCw size={14} aria-hidden /> Check again
            </Button>
            {!ready && checks && (
              <span className="text-xs text-ink-500">Fix the red items first.</span>
            )}
          </div>
        </>
      ) : step === 2 ? (
        <p className="text-sm text-ink-300">
          Forge is on it: follow the card below and the chat. It takes from a few minutes to half an
          hour; you can leave this page.
        </p>
      ) : (
        <div className="text-sm text-ink-300">
          <p>
            It passed every check. In the chat, say <b className="text-ink-100">install it</b>{' '}
            (Forge asks first), then try it anywhere:{' '}
            <b className="text-ink-100">&quot;convert 100 US dollars to rupees&quot;</b>.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Settings → Connections lists it as forge-currency, where you can switch it off or remove
            it.
          </p>
        </div>
      )}
    </section>
  );
}
