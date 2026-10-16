import type { ComponentType } from 'react';
import {
  Activity,
  BookOpen,
  BrainCircuit,
  Database,
  FolderLock,
  Info,
  Keyboard,
  KeyRound,
  Library,
  Mic,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
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
  icon: LucideIcon;
  group: SettingsGroup;
  /** Extra words the settings search matches (what Sir would type, not the label). */
  keywords: string;
  /** Brings its own header and layout (moved here from the sidebar). */
  full?: boolean;
}

/** Most-used first: what Sir changes weekly sits at the top, what he never touches at the bottom. */
export const SETTINGS_GROUPS = ['Essentials', 'Abilities', 'Safety', 'System', 'Help'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** Design-system.md §5.6 settings groups. Later features append their sections. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'general',
    label: 'General',
    group: 'Essentials',
    icon: SlidersHorizontal,
    keywords: 'name theme accent orb style start windows login appearance',
    Component: GeneralSection,
  },
  {
    id: 'brain',
    label: 'Models & AI',
    group: 'Essentials',
    icon: BrainCircuit,
    keywords:
      'claude api key subscription openai gemini deepseek grok local ollama budget model brain',
    Component: BrainSection,
  },
  {
    id: 'voice',
    label: 'Voice',
    group: 'Essentials',
    icon: Mic,
    keywords: 'microphone wake word speech stt tts speak listen hear voice match kokoro edge',
    Component: VoiceSection,
  },
  {
    id: 'memory',
    label: 'Memory',
    group: 'Essentials',
    icon: Library,
    keywords: 'vault obsidian recall remember import chatgpt embeddings',
    Component: MemorySection,
  },
  {
    id: 'everyday',
    label: 'Everyday',
    group: 'Abilities',
    icon: Sparkles,
    keywords: 'weather town briefing claude code announce notifications hugging face',
    Component: EverydaySection,
  },
  {
    id: 'dictation',
    label: 'Dictation',
    group: 'Abilities',
    icon: MessageSquareText,
    keywords: 'type paste transcribe hotkey',
    Component: DictationSection,
  },
  {
    id: 'telegram',
    label: 'Phone & chat apps',
    group: 'Abilities',
    icon: Smartphone,
    keywords: 'telegram whatsapp phone remote qr',
    Component: PhoneSection,
  },
  {
    id: 'hotkeys',
    label: 'Hotkeys',
    group: 'Abilities',
    icon: Keyboard,
    keywords: 'shortcut keyboard ctrl alt',
    Component: HotkeysSection,
  },
  {
    id: 'files',
    label: 'Files & permissions',
    group: 'Safety',
    icon: FolderLock,
    keywords: 'folders allowed denied confirm tier',
    Component: FilesSection,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    group: 'Safety',
    icon: ShieldCheck,
    keywords: 'quiet redact screen telemetry',
    Component: PrivacySection,
  },
  {
    id: 'passwords',
    label: 'Passwords',
    group: 'Safety',
    icon: KeyRound,
    keywords: 'vault credentials login',
    Component: PasswordsSection,
  },
  {
    id: 'data',
    label: 'Data & backups',
    group: 'System',
    icon: Database,
    keywords: 'export backup restore delete reset',
    Component: DataSection,
  },
  {
    id: 'activity',
    label: 'Activity & usage',
    group: 'System',
    icon: Activity,
    keywords: 'cost spend tokens history audit log',
    Component: ActivityView,
    full: true,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    group: 'System',
    icon: Wrench,
    keywords: 'limits iterations computer control logs debug',
    Component: AdvancedSection,
  },
  {
    id: 'bible',
    label: 'Bible (help)',
    group: 'Help',
    icon: BookOpen,
    keywords: 'help guide docs manual troubleshooting',
    Component: BibleView,
    full: true,
  },
  {
    id: 'about',
    label: 'About',
    group: 'Help',
    icon: Info,
    keywords: 'version update credits licence',
    Component: AboutSection,
  },
];

/** Sections whose label or keywords contain every word typed. */
export function matchSections(query: string): SettingsSectionDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return SETTINGS_SECTIONS;
  return SETTINGS_SECTIONS.filter((s) => {
    const hay = `${s.label} ${s.keywords}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
