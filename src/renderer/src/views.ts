import type { ComponentType } from 'react';
import { ConfirmDialog } from './components/jarvis/confirm-dialog';
import { ConnectionsView } from './features/connections/connections-view';
import { CopilotView } from './features/copilot/copilot-view';
import { MemoryView } from './features/memory/memory-view';
import { BrainView } from './features/brain/brain-view';
import { PasswordsView } from './features/passwords/passwords-view';
import { SpacesView } from './features/spaces/spaces-view';
import { AutomationsView, SkillsView } from './features/settings/feature-views';
import { installVoiceBridge } from './features/voice/voice-bridge';
import { registerBridge } from './lib/ipc-bridge';
import { useConfirmStore } from './stores/confirm-store';
import { useMcpStore } from './stores/mcp-store';
import { useStageStore } from './stores/stage-store';
import { useMemoryStore } from './stores/memory-store';
import type { View } from './stores/ui-store';

/** Views and always-mounted overlays added by features beyond chat + settings. */
export const EXTRA_VIEWS: Partial<Record<View, ComponentType>> = {
  memory: MemoryView,
  connections: ConnectionsView,
  copilot: CopilotView,
  spaces: SpacesView,
  brain: BrainView,
  passwords: PasswordsView,
  automations: AutomationsView,
  skills: SkillsView,
};
export const APP_OVERLAYS: ComponentType[] = [ConfirmDialog];

registerBridge((on) => [
  on('confirm:request', (p) => useConfirmStore.getState().show(p)),
  on('confirm:resolved', (p) => useConfirmStore.getState().resolved(p.requestId)),
  on('memory:changed', () => useMemoryStore.getState().bump()),
  on('stage:panel', (p) => useStageStore.getState().show(p.panel)),
  on('mcp:status', (p) =>
    useMcpStore
      .getState()
      .setStatus(p.server, { status: p.status, toolCount: p.toolCount, error: p.error }),
  ),
]);
installVoiceBridge();
