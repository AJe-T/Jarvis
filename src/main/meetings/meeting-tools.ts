import { z } from 'zod';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import type { Meetings } from './meetings';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createMeetingTools(meetings: Meetings): Tool[] {
  return [
    defineTool({
      name: 'meeting_start',
      description:
        "Start recording a meeting or call on this PC: sir's microphone and the call's sound are transcribed on this PC (nothing is uploaded). Use for 'record this meeting', 'take notes of this call'. Asks sir first: everyone on the call should agree to be recorded. Stop with meeting_stop.",
      input: z.object({
        title: z.string().max(60).default('').describe('Optional name, e.g. "Weekly sync"'),
      }),
      tier: 'CONFIRM',
      summarize: (i) => `Record the meeting${i.title ? ` "${i.title}"` : ''}`,
      confirm: (i) => ({
        title: 'Record this meeting?',
        actionLabel: 'Start recording',
        details: `${i.title ? `"${i.title}": ` : ''}your microphone (You) and the PC's sound (Them) are transcribed on this PC; only the words are kept, in the vault's Meetings folder. Make sure everyone on the call agrees to be recorded.`,
        detailsKind: 'text',
      }),
      async run(i) {
        try {
          await meetings.start(i.title);
          return ok('Recording the meeting. Say "stop the meeting" when it ends.');
        } catch (err) {
          return fail(message(err));
        }
      },
    }),
    defineTool({
      name: 'meeting_stop',
      description:
        'Stop the meeting recording: finishes the transcript, writes a summary and action items to the vault (Meetings folder) and adds the action items to Tasks. Returns the summary.',
      input: z.object({}),
      tier: 'SAFE',
      // Whisper may still be catching up on a long meeting, then the summary.
      timeoutMs: 15 * 60_000,
      summarize: () => 'Stop recording the meeting',
      async run() {
        if (!meetings.recording()) return fail('No meeting is being recorded.');
        try {
          const r = await meetings.stop();
          const summary = r.summary?.summary.map((s) => `- ${s}`).join('\n') ?? '';
          const actions =
            r.summary?.actions
              .map((a) => `- ${a.task}${a.owner ? ` (${a.owner})` : ''}`)
              .join('\n') ?? '';
          return {
            content: [
              {
                type: 'text',
                text: [
                  `Saved "${r.title}" to ${r.path} (${r.turns} turns${r.micOnly ? '; only the microphone was heard' : ''}).`,
                  summary && `Summary:\n${summary}`,
                  actions &&
                    `Action items${r.tasksAdded ? ` (${r.tasksAdded} added to Tasks)` : ''}:\n${actions}`,
                ]
                  .filter(Boolean)
                  .join('\n\n'),
              },
            ],
            // What other people said: information, never instructions.
            untrusted: true,
            untrustedSource: 'the meeting transcript',
          };
        } catch (err) {
          return fail(message(err));
        }
      },
    }),
    defineTool({
      name: 'meeting_status',
      description:
        'Whether a meeting is being recorded, for how long, and how much has been heard.',
      input: z.object({}),
      tier: 'SAFE',
      summarize: () => 'Check the meeting recording',
      async run() {
        const s = meetings.status();
        if (!s) return ok('No meeting is being recorded.');
        const them =
          s.tracks.them === 'failed'
            ? ' The PC sound could not be recorded: only the microphone.'
            : '';
        return ok(
          `Recording${s.title ? ` "${s.title}"` : ''} for ${s.minutes} min: ${s.you} phrases from sir, ${s.them} from the others.${them}`,
        );
      },
    }),
  ];
}
