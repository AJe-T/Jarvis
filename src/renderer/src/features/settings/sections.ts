import type { ComponentType } from 'react';
import { BrainSection } from './brain-section';
import { FilesSection } from './files-section';
import { GeneralSection, HotkeysSection, PrivacySection } from './general-sections';

export interface SettingsSectionDef {
  id: string;
  label: string;
  Component: ComponentType;
}

/** Design-system.md §5.6 settings groups. Later features append their sections. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'general', label: 'General', Component: GeneralSection },
  { id: 'brain', label: 'Models & budget', Component: BrainSection },
  { id: 'files', label: 'Files & permissions', Component: FilesSection },
  { id: 'privacy', label: 'Privacy', Component: PrivacySection },
  { id: 'hotkeys', label: 'Hotkeys', Component: HotkeysSection },
];
