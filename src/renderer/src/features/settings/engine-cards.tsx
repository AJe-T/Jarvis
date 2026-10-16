import clsx from 'clsx';
import type { EngineFacts, EngineInfo } from '@shared/speech-engines';
import { call } from '../../lib/api';

const WHERE: Record<EngineFacts['where'], { label: string; tone: string }> = {
  device: { label: 'On this PC', tone: 'border-current text-ok-400' },
  cloud: { label: 'Cloud', tone: 'border-current text-lamp-400' },
  server: { label: 'Your server', tone: 'border-current text-accent-300' },
};

/** Small labelled tags (where it runs, cost, speed, quality, languages) for comparing engines. */
export function FactChips({
  facts,
}: {
  facts: Partial<EngineFacts> & { extra?: string[] };
}): React.JSX.Element {
  const plain = [
    facts.cost,
    facts.speed && `Speed: ${facts.speed}`,
    facts.quality && `Quality: ${facts.quality}`,
    facts.languages,
    ...(facts.extra ?? []),
  ].filter((t): t is string => !!t);
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      {facts.where && (
        <span
          className={clsx(
            'rounded-full border px-2 py-0.5 text-[11px] font-medium',
            WHERE[facts.where].tone,
          )}
        >
          {WHERE[facts.where].label}
        </span>
      )}
      {plain.map((t, i) => (
        <span
          key={`${i}-${t}`}
          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-300"
        >
          {t}
        </span>
      ))}
    </span>
  );
}

/** Opens a sign-up or download page in the browser. */
export function ExternalLink({
  url,
  children,
}: {
  url: string;
  children: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="text-accent-300 underline"
      onClick={() => void call('app:openExternal', { url })}
    >
      {children}
    </button>
  );
}

/** A radio card per engine: name, what it is good at, and its facts. */
export function EngineCards<Id extends string>({
  label,
  engines,
  value,
  onChange,
}: {
  label: string;
  engines: ReadonlyArray<EngineInfo<Id>>;
  value: Id;
  onChange(id: Id): void;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {engines.map((e) => (
        <button
          key={e.id}
          type="button"
          role="radio"
          aria-checked={value === e.id}
          onClick={() => onChange(e.id)}
          className={clsx(
            'rounded-md border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent-300',
            value === e.id ? 'border-accent-edge bg-selected' : 'border-line hover:border-ink-500',
          )}
        >
          <span className="block font-semibold text-ink-100">{e.title}</span>
          <span className="mt-1 block text-sm text-ink-300">{e.body}</span>
          <FactChips facts={e} />
        </button>
      ))}
    </div>
  );
}
