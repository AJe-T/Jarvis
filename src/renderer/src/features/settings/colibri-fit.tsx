import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { COLIBRI_BASE_URL, COLIBRI_CHECKED, fitColibri, type ColibriFit } from '@shared/colibri';
import { Button } from '../../components/ui/button';
import { call } from '../../lib/api';
import { useSettingsStore } from '../../stores/settings-store';

/** One click fills in the server address of each local server Jarvis knows. */
const PRESETS = [
  { label: 'Ollama', url: 'http://localhost:11434/v1' },
  { label: 'LM Studio', url: 'http://localhost:1234/v1' },
  { label: 'colibri', url: COLIBRI_BASE_URL },
] as const;

export function LocalServerPresets({ onPicked }: { onPicked(): void }): React.JSX.Element {
  const set = useSettingsStore((s) => s.stage);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Server presets">
      <span className="text-xs text-ink-500">Fill in:</span>
      {PRESETS.map((p) => (
        <Button
          key={p.label}
          variant="ghost"
          onClick={() => void set('llm.local.baseUrl', p.url).then(onPicked)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}

const FIT_LABEL: Record<ColibriFit['fit'], string> = {
  good: 'Runs well',
  slow: 'Runs, slowly',
  'no-ram': 'Not enough RAM',
  'no-disk': 'Not enough free disk',
};

/**
 * colibri (JustVugg/colibri) runs big open models on this PC by reading their experts from disk.
 * This checks RAM and free disk against its model table and names the one to start with.
 */
export function ColibriFitPanel(): React.JSX.Element {
  const [hw, setHw] = useState<Res<'llm:hardware'> | null>(null);
  useEffect(() => {
    void call('llm:hardware', {}).then(setHw);
  }, []);
  if (!hw) return <p className="text-xs text-ink-500">Checking this PC…</p>;
  const { fits, recommended } = fitColibri(hw.ramGb, hw.freeDiskGb);
  return (
    <section
      aria-labelledby="colibri-fit-heading"
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3"
    >
      <h4 id="colibri-fit-heading" className="text-sm font-medium text-ink-100">
        Which colibri model fits this PC
      </h4>
      <p className="text-xs text-ink-300">
        This PC: {hw.ramGb} GB RAM · {hw.freeDiskGb} GB free on the home drive · {hw.cpuCores} CPU
        threads.{' '}
        {recommended ? (
          <>
            Start with <strong className="text-ink-100">{recommended.name}</strong> (
            <code>--model {recommended.id}</code>).
          </>
        ) : (
          'None of its models fit: colibri needs at least 8 GB of RAM and 21 GB of free disk.'
        )}
      </p>
      <ul className="flex flex-col gap-1 text-xs">
        {fits.map((f) => (
          <li key={f.model.id} className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={clsx(
                'min-w-28 font-medium',
                f.fit === 'good'
                  ? 'text-ok-400'
                  : f.fit === 'slow'
                    ? 'text-lamp-400'
                    : 'text-ink-500',
              )}
            >
              {FIT_LABEL[f.fit]}
            </span>
            <span className="text-ink-100">{f.model.name}</span>
            <span className="text-ink-500">
              {f.model.downloadGb} GB download · RAM {f.model.minRamGb}/{f.model.goodRamGb} GB ·{' '}
              {f.model.note}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-500">
        Install: download colibri from github.com/JustVugg/colibri, run <code>START-HERE.bat</code>{' '}
        and pick the model; then press <strong>colibri</strong> above and{' '}
        <strong>Refresh models</strong>. Models that stream from the disk answer about 1–4 words a
        second: fine for private or offline work, too slow for voice. Model sizes from
        colibri&apos;s README, checked {COLIBRI_CHECKED}.
      </p>
    </section>
  );
}
