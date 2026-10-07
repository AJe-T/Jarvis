import { AlertTriangle, Info, X } from 'lucide-react';
import clsx from 'clsx';
import { useUiStore, type Toast } from '../../stores/ui-store';

const ICONS = { info: Info, warn: AlertTriangle, error: AlertTriangle } as const;
const ACTION_LABEL: Record<NonNullable<Toast['action']>, string> = {
  'settings:brain': 'Open Settings → Brain',
  'settings:voice': 'Open Settings → Voice',
  memory: 'Open Memory',
  connections: 'Open Connections',
};

function runAction(action: NonNullable<Toast['action']>): void {
  const go = useUiStore.getState().go;
  if (action === 'settings:brain') go('settings', 'brain');
  else if (action === 'settings:voice') go('settings', 'voice');
  else go(action);
}

/** Bottom-right, max 3; errors persist until dismissed (Design-system.md §5.6). */
export function Toasts(): React.JSX.Element {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-12 z-40 flex w-80 flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.level];
        return (
          <div
            key={t.id}
            role={t.level === 'error' ? 'alert' : 'status'}
            className={clsx(
              'glass-float pointer-events-auto flex items-start gap-2 rounded-lg p-3 text-sm',
              t.level === 'error'
                ? 'shadow-[inset_3px_0_0_var(--alarm-500),var(--shadow-float)]'
                : t.level === 'warn'
                  ? 'shadow-[inset_3px_0_0_var(--lamp-400),var(--shadow-float)]'
                  : '',
            )}
          >
            <Icon
              size={18}
              strokeWidth={1.75}
              aria-hidden
              className={
                t.level === 'error'
                  ? 'text-alarm-500'
                  : t.level === 'warn'
                    ? 'text-lamp-400'
                    : 'text-reactor-500'
              }
            />
            <div className="flex-1">
              <p className="text-ink-100">{t.message}</p>
              {t.action && (
                <button
                  type="button"
                  className="mt-1 text-reactor-500 underline underline-offset-2"
                  onClick={() => (
                    runAction(t.action as NonNullable<Toast['action']>),
                    dismiss(t.id)
                  )}
                >
                  {ACTION_LABEL[t.action]}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="text-ink-500 hover:text-ink-100"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
