import type { ComponentType } from 'react';
import type { View } from './stores/ui-store';

/** Views and always-mounted overlays added by later features (memory, activity log, connections, confirmations). */
export const EXTRA_VIEWS: Partial<Record<View, ComponentType>> = {};
export const APP_OVERLAYS: ComponentType[] = [];
