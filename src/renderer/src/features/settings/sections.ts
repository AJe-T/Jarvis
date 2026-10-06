import type { ComponentType } from 'react';
import { BrainSection } from './brain-section';

export interface SettingsSectionDef {
  id: string;
  label: string;
  Component: ComponentType;
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'brain', label: 'Models & budget', Component: BrainSection },
];
