import type { Req, Res } from '@shared/ipc-contract';

export type Page = Res<'spaces:pages'>[number];
export type Template = Req<'spaces:createPage'>['template'];

export const SPACE_ICONS = [
  '📚',
  '💰',
  '💡',
  '🧠',
  '🏋️',
  '🍳',
  '✈️',
  '🎯',
  '🛠️',
  '🎵',
  '📈',
  '🧾',
  '❤️',
  '🌱',
  '🏠',
  '💼',
  '🎓',
  '📝',
  '🧪',
  '🎮',
  '📷',
  '🗂️',
  '⭐',
  '📁',
];

export const TEMPLATES: Array<{ id: Template; label: string; hint: string }> = [
  { id: 'blank', label: 'Blank page', hint: 'Start from nothing' },
  { id: 'learning', label: 'Learning note', hint: 'Key ideas, questions, next steps' },
  { id: 'journal', label: 'Journal entry', hint: 'How I feel, what happened' },
  { id: 'meeting', label: 'Meeting notes', hint: 'Agenda, decisions, actions' },
  { id: 'finance', label: 'Expense log', hint: 'A table of spending' },
  { id: 'project', label: 'Project plan', hint: 'Goal, milestones, resources' },
];

export function titleFor(template: Template): string {
  if (template === 'journal')
    return new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  if (template === 'blank') return 'Untitled';
  return TEMPLATES.find((t) => t.id === template)?.label ?? 'Untitled';
}

export const ago = (iso: string | null): string => {
  if (!iso) return 'empty';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
