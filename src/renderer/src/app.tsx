import { useEffect, type ComponentType } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Rail } from './components/jarvis/rail';
import { StatusBar } from './components/jarvis/status-bar';
import { ConfirmModalHost } from './components/ui/confirm-modal';
import { Toasts } from './components/ui/toasts';
import { ActivityDrawer } from './features/activity/activity-drawer';
import { ChatView } from './features/chat/chat-view';
import { Onboarding } from './features/onboarding/onboarding';
import { SettingsView } from './features/settings/settings-view';
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

function Shell(): React.JSX.Element {
  const view = useUiStore((s) => s.view);
  const activityOpen = useUiStore((s) => s.activityOpen);
  const Current = VIEWS[view];
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Rail />
        <main className="flex min-w-0 flex-1">
          {Current ? (
            <Current />
          ) : (
            <p className="m-auto text-ink-500">This area is not available yet.</p>
          )}
        </main>
        {view === 'chat' && activityOpen && <ActivityDrawer />}
      </div>
      <StatusBar />
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
      {!loaded ? null : onboarded ? <Shell /> : <Onboarding />}
      {APP_OVERLAYS.map((Overlay, i) => (
        <Overlay key={i} />
      ))}
      <ConfirmModalHost />
      <Toasts />
    </Tooltip.Provider>
  );
}
