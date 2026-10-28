import { AlertTriangle, Info, X } from 'lucide-react';
import { useUiStore, type Toast } from '../../stores/ui-store';

const ICONS = { info: Info, warn: AlertTriangle, error: AlertTriangle } as const;
const ACTION_LABEL: Record<NonNullable<Toast['action']>, string> = {
  'settings:brain': 'Open AI Router → Main brain',
  'settings:voice': 'Open Settings → Voice',
  memory: 'Open Memory',
  connections: 'Open Connections',
};

function runAction(action: NonNullable<Toast['action']>): void {
  const go = useUiStore.getState().go;
  if (action === 'settings:brain') go('router', 'brain');
  else if (action === 'settings:voice') go('settings', 'voice');
  else go(action);
}

/** Top-centre under the header, max 3; errors persist until dismissed (Design-system.md §6.8). */
export function Toasts(): React.JSX.Element {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  return (
    <div
      className="pointer-events-none fixed top-14 left-1/2 z-40 flex w-[min(26rem,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.level];
        return (
          <div
            key={t.id}
            role={t.level === 'error' ? 'alert' : 'status'}
            // §6.8: plain card; the coloured icon says what kind it is.
            className="popover toast-in pointer-events-auto flex items-start gap-2.5 p-3 text-sm"
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
                    : 'text-accent-300'
              }
            />
            <div className="flex-1">
              <p className="text-ink-100">{t.message}</p>
              {t.action && (
                <button
                  type="button"
                  className="mt-1 text-accent-300 underline underline-offset-2"
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
