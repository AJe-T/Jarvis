import type { ComponentType } from 'react';
import { ConfirmDialog } from './components/jarvis/confirm-dialog';
import { ActivityView } from './features/activity/activity-view';
import { registerBridge } from './lib/ipc-bridge';
import { useConfirmStore } from './stores/confirm-store';
import type { View } from './stores/ui-store';

/** Views and always-mounted overlays added by features beyond chat + settings. */
export const EXTRA_VIEWS: Partial<Record<View, ComponentType>> = { activity: ActivityView };
export const APP_OVERLAYS: ComponentType[] = [ConfirmDialog];

registerBridge((on) => [
  on('confirm:request', (p) => useConfirmStore.getState().show(p)),
  on('confirm:resolved', (p) => useConfirmStore.getState().resolved(p.requestId)),
]);
