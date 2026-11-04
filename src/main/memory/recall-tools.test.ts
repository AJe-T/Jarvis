import { describe, expect, it } from 'vitest';
import { logger } from '../logging/logger';
import type { ToolCallRow } from '../db/repos/tool-calls-repo';
import type { Tool, ToolContext } from '../tools/types';
import { actionLine, createRecallTools, mergeTimeline, type RecallDeps } from './recall-tools';
import { indexSnippet, INDEX_SNIPPET_CHARS } from './retriever';

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

const action = (over: Partial<ToolCallRow>): ToolCallRow =>
  ({
    tool_name: 'open_app',
    human_summary: 'Open Spotify',
    status: 'success',
    decision: 'auto',
    created_at: '2026-11-03T09:00:00.000Z',
    ...over,
  }) as ToolCallRow;

function tools(over: Partial<RecallDeps> = {}): Record<string, Tool> {
  const deps: RecallDeps = {
    vault: {
      exists: (rel) => rel === 'Memory/People/Priya.md',
      read: async () => ({ body: 'Priya is getting married in December.' }),
    },
    notesChanged: () => [],
    messagesBetween: () => [],
    actionsBetween: () => [],
    dayRange: () => ({ from: '2026-11-02T18:30:00.000Z', to: '2026-11-03T18:30:00.000Z' }),
    ...over,
  };
  return Object.fromEntries(createRecallTools(deps).map((t) => [t.name, t]));
}

const text = async (t: Tool | undefined, input: unknown): Promise<string> => {
  if (!t) throw new Error('tool missing');
  const out = await t.run(t.input.parse(input), ctx);
  return out.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
};

describe('three-step recall', () => {
  it('cuts index snippets at a word only when compact recall is on', () => {
    const long = 'word '.repeat(100);
    expect(indexSnippet(long, false)).toBe(long);
    const short = indexSnippet(long, true);
    expect(short.length).toBeLessThanOrEqual(INDEX_SNIPPET_CHARS + 1);
    expect(short.endsWith('word…')).toBe(true);
    expect(indexSnippet('tiny note', true)).toBe('tiny note');
  });

  it('memory_get reads notes in full, refuses non-notes and says when a note is missing', async () => {
    const out = await text(tools().memory_get, {
      paths: ['Memory/People/Priya.md', 'Memory/Gone.md', 'secrets.txt'],
    });
    expect(out).toContain('Priya is getting married in December.');
    expect(out).toContain('## Memory/Gone.md\n(no such note)');
    expect(out).toContain('(not a note: only memory notes, .md)');
    const internal = await text(tools().memory_get, { paths: ['_jarvis/state.md'] });
    expect(internal).toContain('not a note');
  });

  it('labels each action with how it ended, denied ones included', () => {
    expect(actionLine(action({}))).toBe('Open Spotify (done)');
    expect(actionLine(action({ decision: 'denied', status: 'not_run' }))).toBe(
      'Open Spotify (denied)',
    );
    expect(actionLine(action({ status: 'error' }))).toBe('Open Spotify (failed)');
  });

  it('merges notes, chats and actions oldest first and keeps the newest when over the limit', () => {
    const lines = mergeTimeline(
      [
        { at: '2026-11-03T10:00:00.000Z', kind: 'action', text: 'b' },
        { at: '2026-11-03T09:00:00.000Z', kind: 'note', text: 'a' },
        { at: '2026-11-03T11:00:00.000Z', kind: 'chat', text: 'c' },
      ],
      2,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/ · action · b$/);
    expect(lines[1]).toMatch(/ · chat · c$/);
  });

  it('recall_timeline leaves out its own calls and honours include', async () => {
    const t = tools({
      actionsBetween: () => [
        action({}),
        action({ tool_name: 'recall_timeline', human_summary: 'Look back' }),
      ],
      messagesBetween: () => [
        {
          id: 'm',
          conversationId: 'c',
          createdAt: '2026-11-03T08:00:00.000Z',
          role: 'user',
          title: 't',
          snippet: 'play some music',
        },
      ],
    });
    const all = await text(t.recall_timeline, { from: '2026-11-03' });
    expect(all).toContain('action · Open Spotify (done)');
    expect(all).toContain('chat · sir: play some music');
    expect(all).not.toContain('Look back');
    const onlyActions = await text(t.recall_timeline, { from: '2026-11-03', include: ['actions'] });
    expect(onlyActions).not.toContain('play some music');
  });
});
