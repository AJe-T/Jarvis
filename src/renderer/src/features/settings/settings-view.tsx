import clsx from 'clsx';
import { useUiStore } from '../../stores/ui-store';
import { SETTINGS_SECTIONS } from './sections';

/** Design-system.md §5.6: grouped settings forms. */
export function SettingsView(): React.JSX.Element {
  const section = useUiStore((s) => s.settingsSection);
  const go = useUiStore((s) => s.go);
  const current = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];
  const Body = current?.Component;
  return (
    <div className="flex min-w-0 flex-1 bg-night-900">
      <nav
        aria-label="Settings sections"
        className="w-52 shrink-0 border-r border-night-600 px-2 py-4"
      >
        <h1 className="px-3 pb-3 font-display text-lg font-semibold text-ink-100">Settings</h1>
        <ul className="flex flex-col gap-0.5">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={s.id === current?.id ? 'page' : undefined}
                onClick={() => go('settings', s.id)}
                className={clsx(
                  'w-full rounded-md px-3 py-1.5 text-left text-sm',
                  s.id === current?.id
                    ? 'bg-night-700 text-ink-100'
                    : 'text-ink-300 hover:bg-night-800',
                )}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 overflow-y-auto px-8 py-2">
        <div className="max-w-2xl">{Body && <Body />}</div>
      </div>
    </div>
  );
}
