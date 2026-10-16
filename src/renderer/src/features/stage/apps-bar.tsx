import { useEffect, useState } from 'react';
import { LayoutGrid, X } from 'lucide-react';
import { IconButton } from '../../components/ui/button';
import { useUiStore } from '../../stores/ui-store';
import { AppsGrid } from '../apps/apps-grid';

/**
 * Core's "All apps" (ADR-040): the same apps as Sidebar → Apps, in a dialog over the stage. Picking
 * one opens it beside the orb.
 */
export function AppsBar(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const go = useUiStore((s) => s.go);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <IconButton label="All apps" tipSide="bottom" active={open} onClick={() => setOpen(true)}>
        <LayoutGrid size={18} strokeWidth={1.75} aria-hidden />
      </IconButton>
      {open && (
        <div
          className="scrim fixed inset-0 z-40 grid place-items-center p-6"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="All apps"
            className="popover flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-5"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-ui font-semibold text-ink-100">All apps</h2>
              <button
                type="button"
                className="text-sm text-accent-300 underline-offset-2 hover:underline"
                onClick={() => {
                  setOpen(false);
                  go('apps');
                }}
              >
                Open the Apps page
              </button>
              <IconButton label="Close" className="ml-auto" onClick={() => setOpen(false)}>
                <X size={16} aria-hidden />
              </IconButton>
            </div>
            <AppsGrid onLaunch={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
