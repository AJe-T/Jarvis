import type { ComponentType } from 'react';
import { AdvancedSection } from './advanced-section';
import { DictationSection } from './dictation-section';
import { PhoneSection } from './phone-section';
import { PasswordsSection } from './passwords-section';
import { AboutSection, DataSection } from './data-sections';
import { ActivityView } from '../activity/activity-view';
import { BibleView } from '../bible/bible-view';
import { BrainSection } from './brain-section';
import { FilesSection } from './files-section';
import { MemorySection } from './memory-section';
import { VoiceSection } from './voice-section';
import {
  EverydaySection,
  GeneralSection,
  HotkeysSection,
  PrivacySection,
} from './general-sections';

export interface SettingsSectionDef {
  id: string;
  label: string;
  Component: ComponentType;
  /** Brings its own header and layout (moved here from the sidebar). */
  full?: boolean;
}

/** Design-system.md §5.6 settings groups. Later features append their sections. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'general', label: 'General', Component: GeneralSection },
  { id: 'everyday', label: 'Everyday', Component: EverydaySection },
  { id: 'brain', label: 'Models & budget', Component: BrainSection },
  { id: 'files', label: 'Files & permissions', Component: FilesSection },
  { id: 'memory', label: 'Memory', Component: MemorySection },
  { id: 'telegram', label: 'Phone & chat apps', Component: PhoneSection },
  { id: 'passwords', label: 'Passwords', Component: PasswordsSection },
  { id: 'voice', label: 'Voice', Component: VoiceSection },
  { id: 'dictation', label: 'Dictation', Component: DictationSection },
  { id: 'privacy', label: 'Privacy', Component: PrivacySection },
  { id: 'hotkeys', label: 'Hotkeys', Component: HotkeysSection },
  { id: 'data', label: 'Data & backups', Component: DataSection },
  { id: 'advanced', label: 'Advanced', Component: AdvancedSection },
  { id: 'activity', label: 'Activity & usage', Component: ActivityView, full: true },
  { id: 'bible', label: 'Bible (help)', Component: BibleView, full: true },
  { id: 'about', label: 'About', Component: AboutSection },
];
