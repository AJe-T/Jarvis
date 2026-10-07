import clsx from 'clsx';
import { useUiStore } from '../../stores/ui-store';
import { PageBody, PageHeader } from '../../components/ui/page';
import { SETTINGS_SECTIONS } from './sections';

/** Design-system.md §5.6: grouped settings forms. */
export function SettingsView(): React.JSX.Element {
  const section = useUiStore((s) => s.settingsSection);
  const go = useUiStore((s) => s.go);
  const current = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];
  const Body = current?.Component;
  return (
    <div className="flex min-w-0 flex-1">
      <nav
        aria-label="Settings sections"
        className="flex w-44 shrink-0 flex-col overflow-hidden border-r border-line-subtle md:w-56"
      >
        <div className="flex h-12 shrink-0 items-center border-b border-line-subtle px-4">
          <h1 className="text-ui font-semibold text-ink-100">Settings</h1>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={s.id === current?.id ? 'page' : undefined}
                onClick={() => go('settings', s.id)}
                className={clsx(
                  'w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-[120ms]',
                  s.id === current?.id
                    ? 'bg-selected font-medium text-ink-100'
                    : 'text-ink-300 hover:bg-hover hover:text-ink-100',
                )}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title={current?.label ?? 'Settings'} />
        <PageBody key={current?.id} className="fade-in">
          {Body && <Body />}
        </PageBody>
      </div>
    </div>
  );
}
