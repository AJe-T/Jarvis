import { useState } from 'react';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { PageBody, PageHeader } from '../../components/ui/page';
import { SaveBar } from './save-bar';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, matchSections } from './sections';

/** Design-system.md §5.6: grouped settings forms, most-used groups first, with a search. */
export function SettingsView(): React.JSX.Element {
  const section = useUiStore((s) => s.settingsSection);
  const go = useUiStore((s) => s.go);
  const [query, setQuery] = useState('');
  const current = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];
  const Body = current?.Component;
  const shown = matchSections(query);
  return (
    <div className="flex min-w-0 flex-1">
      <nav
        aria-label="Settings sections"
        className="flex w-48 shrink-0 flex-col overflow-hidden border-r border-line-subtle md:w-60"
      >
        <div className="flex h-12 shrink-0 items-center border-b border-line-subtle px-4">
          <h1 className="page-title font-code text-sm font-semibold tracking-[0.14em] text-ink-100 uppercase">
            Settings
          </h1>
        </div>
        <label className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 focus-within:border-accent-edge">
          <Search size={14} aria-hidden className="text-ink-500" />
          <input
            type="search"
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const [first] = shown;
              if (e.key === 'Enter' && first) go('settings', first.id);
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-100 outline-none placeholder:text-ink-500"
          />
        </label>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {shown.length === 0 && <p className="px-2.5 text-sm text-ink-500">No match.</p>}
          {SETTINGS_GROUPS.map((group) => {
            const items = shown.filter((s) => s.group === group);
            if (!items.length) return null;
            return (
              <section key={group} aria-label={group}>
                <h2 className="px-2.5 pb-1 font-code text-[10px] font-semibold tracking-[0.16em] text-ink-500 uppercase">
                  {group}
                </h2>
                <ul className="flex flex-col gap-0.5">
                  {items.map((s) => {
                    const Icon = s.icon;
                    const on = s.id === current?.id;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          aria-current={on ? 'page' : undefined}
                          onClick={() => go('settings', s.id)}
                          className={clsx(
                            'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-[120ms]',
                            on
                              ? 'bg-selected font-medium text-ink-100'
                              : 'text-ink-300 hover:bg-hover hover:text-ink-100',
                          )}
                        >
                          {on && (
                            <span
                              aria-hidden
                              className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent-600 shadow-[0_0_8px_var(--accent-glow)]"
                            />
                          )}
                          <Icon
                            size={15}
                            aria-hidden
                            className={
                              on ? 'text-accent-300' : 'text-ink-500 group-hover:text-ink-300'
                            }
                          />
                          {s.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {current?.full ? (
          <div key={current.id} className="fade-in flex min-h-0 min-w-0 flex-1">
            {Body && <Body />}
          </div>
        ) : (
          <>
            <PageHeader
              title={current?.label ?? 'Settings'}
              help={`settings.${current?.id ?? 'general'}`}
            />
            <PageBody key={current?.id} className="fade-in">
              {Body && <Body />}
            </PageBody>
          </>
        )}
        <SaveBar />
      </div>
    </div>
  );
}
