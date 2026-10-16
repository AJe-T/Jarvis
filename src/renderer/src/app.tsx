import { useEffect, useState, type ComponentType } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ThemeSync } from './components/jarvis/theme-sync';
import { OrbDock } from './components/jarvis/orb-dock';
import { Rail } from './components/jarvis/rail';
import { TitleBar } from './components/jarvis/titlebar';
import { ConfirmModalHost } from './components/ui/confirm-modal';
import { Toasts } from './components/ui/toasts';
import { ActivityDrawer } from './features/activity/activity-drawer';
import { ChatView } from './features/chat/chat-view';
import { Onboarding } from './features/onboarding/onboarding';
import { SettingsView } from './features/settings/settings-view';
import { call } from './lib/api';
import { startIpcBridge } from './lib/ipc-bridge';
import { useChatStore } from './stores/chat-store';
import { useSetting, useSettingsStore } from './stores/settings-store';
import { useUiStore, type View } from './stores/ui-store';
import { APP_OVERLAYS, EXTRA_VIEWS } from './views';

const VIEWS: Partial<Record<View, ComponentType>> = {
  chat: ChatView,
  settings: SettingsView,
  ...EXTRA_VIEWS,
};

/** Database.md §8: integrity check failed at startup — point Sir at a backup instead of failing silently. */
function DbBanner(): React.JSX.Element | null {
  const [healthy, setHealthy] = useState(true);
  const go = useUiStore((s) => s.go);
  useEffect(() => void call('app:info', {}).then((i) => setHealthy(i.dbHealthy)), []);
  if (healthy) return null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 bg-alarm-fill px-4 py-2 text-sm text-ink-on-alarm"
    >
      Jarvis's database failed its integrity check. Some history may be missing.
      <button type="button" className="underline" onClick={() => go('settings', 'data')}>
        Restore a backup
      </button>
    </div>
  );
}

/** §5.1: HUD shell: sidebar and gridded canvas edge to edge (no title or status bar); scanlines over it all and the orb on every screen. */
function Shell(): React.JSX.Element {
  const view = useUiStore((s) => s.view);
  const activityOpen = useUiStore((s) => s.activityOpen);
  const toggleActivity = useUiStore((s) => s.toggleActivity);
  const Current = VIEWS[view];
  const drawer = view === 'chat' && activityOpen;

  // Escape closes the drawer while it is an overlay sheet (below lg).
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !window.matchMedia('(min-width: 1200px)').matches) toggleActivity();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, toggleActivity]);
  return (
    <div className="scanlines flex h-full flex-col bg-app">
      <DbBanner />
      <div className="flex min-h-0 flex-1">
        <Rail />
        <main className="panel relative flex min-w-0 flex-1 overflow-hidden">
          {Current ? (
            // §8: views fade in; nothing slides.
            <div key={view} className="view-enter flex min-w-0 flex-1">
              <Current />
            </div>
          ) : (
            <p className="m-auto text-ink-500">This area is not available yet.</p>
          )}
          <OrbDock />
        </main>
        {drawer && (
          // Below lg the drawer is an overlay sheet; the scrim closes it.
          <div
            className="scrim fixed inset-0 z-20 lg:hidden"
            onClick={toggleActivity}
            aria-hidden
          />
        )}
        {drawer && <ActivityDrawer />}
      </div>
      <TitleBar />
    </div>
  );
}

export function App(): React.JSX.Element {
  const loaded = useSettingsStore((s) => s.loaded);
  const onboarded = useSetting('onboarding.complete');

  useEffect(() => {
    const stop = startIpcBridge();
    void useSettingsStore.getState().load();
    void useChatStore.getState().loadConversations();
    return stop;
  }, []);

  return (
    <Tooltip.Provider>
      <ThemeSync />
      {!loaded ? null : onboarded ? <Shell /> : <Onboarding />}
      {APP_OVERLAYS.map((Overlay, i) => (
        <Overlay key={i} />
      ))}
      <ConfirmModalHost />
      <Toasts />
    </Tooltip.Provider>
  );
}
