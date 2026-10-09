import { z } from 'zod';
import { StagePanelSchema, type StagePanel } from '@shared/stage';
import { defineTool, ok, type Tool } from '../tools/types';

const TIMEOUT_MS = 2_000;

/**
 * show_panel / hide_panel (Design-system.md §5.2a): Jarvis moves the orb aside and shows a panel on
 * his main screen. Display only (nothing leaves the PC, nothing changes), so SAFE.
 */
export function createStageTools(show: (panel: StagePanel | null) => void): Tool[] {
  return [
    defineTool({
      name: 'show_panel',
      description:
        "Show a panel on sir's main screen beside the orb, when he asks to see or display something. kind: 'pomodoro' (focus timer: minutes, breakMinutes), 'usage' (AI usage and billing), 'status' (Jarvis dashboard), 'list' (title + items, e.g. tasks or an agenda), 'stats' (title + labelled values, optional percent), 'note' (title + Markdown). Replaces any panel already shown. Keep spoken replies short; the panel carries the detail.",
      input: z.object({ panel: StagePanelSchema }),
      tier: 'SAFE',
      timeoutMs: TIMEOUT_MS,
      summarize: ({ panel }) =>
        `Show ${'title' in panel ? `"${panel.title}"` : panel.kind} on screen`,
      async run({ panel }) {
        show(panel);
        return Promise.resolve(ok(`Showing the ${panel.kind} panel beside the orb.`));
      },
    }),
    defineTool({
      name: 'hide_panel',
      description: "Close the panel on sir's main screen and bring the orb back to the centre.",
      input: z.object({}).strict(),
      tier: 'SAFE',
      timeoutMs: TIMEOUT_MS,
      summarize: () => 'Close the panel on screen',
      async run() {
        show(null);
        return Promise.resolve(ok('Panel closed.'));
      },
    }),
  ];
}
