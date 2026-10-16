import { useEffect, useRef } from 'react';
import { JARVIS_APP_INFO, type DockedKind } from '@shared/jarvis-apps';
import { call } from '../../lib/api';

/** Something drawn over the stage that a native app view must not hide (dialogs, menus). */
const COVERS = '[role="dialog"][aria-modal="true"], [role="menu"], [data-covers-apps]';

/**
 * ADR-040: a hole in Core's panel where main places an app's own isolated page (Jarvis Browser,
 * Terminal, Camera). This only reports where the hole is; the app never runs in this renderer.
 */
export function DockedPanel({ app }: { app: DockedKind }): React.JSX.Element {
  const hole = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = hole.current;
    if (!el) return;
    let frame = 0;
    let last = '';
    const send = (): void => {
      const r = el.getBoundingClientRect();
      const covered = !!document.querySelector(COVERS);
      const bounds =
        covered || r.width < 2 || r.height < 2
          ? null
          : { x: r.left, y: r.top, width: r.width, height: r.height };
      const key = JSON.stringify(bounds);
      if (key === last) return;
      last = key;
      void call('apps:dock', { app, open: true, bounds }).catch(() => undefined);
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(send);
    };
    schedule();
    const size = new ResizeObserver(schedule);
    size.observe(el);
    const page = new MutationObserver(schedule);
    page.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    // The stage slides the panel in: measure again once it has settled.
    document.addEventListener('animationend', schedule);
    document.addEventListener('transitionend', schedule);
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      page.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('animationend', schedule);
      document.removeEventListener('transitionend', schedule);
      void call('apps:dock', { app, open: false, bounds: null }).catch(() => undefined);
    };
  }, [app]);
  return (
    <div
      ref={hole}
      className="grid h-full min-h-80 w-full place-items-center bg-[#0b0f14] text-sm text-ink-500"
    >
      Opening {JARVIS_APP_INFO[app].label}…
    </div>
  );
}
