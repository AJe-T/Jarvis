import { z } from 'zod';
import {
  EventPatchSchema,
  TodoPatchSchema,
  type CalEvent,
  type EventPatch,
  type Todo,
  type TodoPatch,
} from '@shared/planner';
import { errorMessage } from '../errors';
import type { Planner } from '../planner/planner';
import { defineTool, fail, ok, type Tool } from './types';

/**
 * Undo for what Jarvis did (2.70): each reversible action records how to take it back, and
 * "undo that" runs the newest one. Covers his file tools (create, overwrite, move, rename, copy,
 * new folder) and his task and calendar changes. Things Sir did himself in the app are not here.
 *
 * In memory only: the list is empty after a restart. An undo never forces anything: if the file
 * or task changed since, it says so and leaves it alone (Security.md §16.21).
 */

const MAX_ENTRIES = 30;

export interface UndoInfo {
  id: number;
  label: string;
  at: number;
}

interface Entry extends UndoInfo {
  /** Takes the action back and says what it did; throws (with a plain message) when it can't. */
  undo(): Promise<string>;
}

export type UndoJournal = ReturnType<typeof createUndoJournal>;

export function createUndoJournal(now: () => number = Date.now) {
  let entries: Entry[] = []; // oldest first
  let nextId = 1;
  return {
    /** `label` says what Jarvis did ("Move report.pdf to Archive"), as Sir will read it. */
    record(label: string, undo: () => Promise<string>): void {
      entries = [...entries, { id: nextId++, label, at: now(), undo }].slice(-MAX_ENTRIES);
    },
    last(): UndoInfo | undefined {
      const e = entries.at(-1);
      return e ? { id: e.id, label: e.label, at: e.at } : undefined;
    },
    /** Newest first. */
    list(): UndoInfo[] {
      return entries.map((e) => ({ id: e.id, label: e.label, at: e.at })).reverse();
    },
    /**
     * Takes back the newest action. Either way it leaves the list: a failed undo is not retried
     * blindly. `id` makes sure it is the action Sir was shown.
     */
    async undoLast(id?: number): Promise<{ label: string; ok: boolean; result: string } | null> {
      const entry = entries.at(-1);
      if (!entry || (id !== undefined && entry.id !== id)) return null;
      entries = entries.slice(0, -1);
      try {
        return { label: entry.label, ok: true, result: await entry.undo() };
      } catch (err) {
        return { label: entry.label, ok: false, result: errorMessage(err) };
      }
    },
    clear(): void {
      entries = [];
    },
  };
}

const todoPatch = (t: Todo): TodoPatch => TodoPatchSchema.parse(t);
const eventPatch = (e: CalEvent): EventPatch => EventPatchSchema.parse(e);

/**
 * The planner as Jarvis's tools see it: every task and calendar change he makes records how to
 * put the earlier state back. A deleted item comes back as a new item with the same contents.
 */
export function undoablePlanner(planner: Planner, journal: UndoJournal): Planner {
  const restoreTodo = (before: Todo): string => {
    if (planner.todo(before.id)) planner.saveTodo({ ...todoPatch(before), id: before.id });
    else planner.saveTodo({ ...todoPatch(before), id: undefined, parentId: null });
    return `Task "${before.title}" is back as it was.`;
  };
  const restoreEvent = (before: CalEvent): string => {
    if (planner.event(before.id)) planner.saveEvent({ ...eventPatch(before), id: before.id });
    else planner.saveEvent({ ...eventPatch(before), id: undefined });
    return `Event "${before.title}" is back as it was.`;
  };
  return {
    ...planner,
    saveTodo(patch) {
      const before = patch.id ? planner.todo(patch.id) : undefined;
      const saved = planner.saveTodo(patch);
      journal.record(before ? `Change task "${before.title}"` : `Add task "${saved.title}"`, () => {
        if (before) return Promise.resolve(restoreTodo(before));
        if (!planner.todo(saved.id)) throw new Error(`Task "${saved.title}" is already gone.`);
        planner.deleteTodo(saved.id);
        return Promise.resolve(`Removed task "${saved.title}".`);
      });
      return saved;
    },
    deleteTodo(id) {
      const before = planner.todo(id);
      planner.deleteTodo(id);
      if (before)
        journal.record(`Delete task "${before.title}"`, () => Promise.resolve(restoreTodo(before)));
    },
    saveEvent(patch) {
      const before = patch.id ? planner.event(patch.id) : undefined;
      const saved = planner.saveEvent(patch);
      journal.record(
        before ? `Change event "${before.title}"` : `Add event "${saved.title}"`,
        () => {
          if (before) return Promise.resolve(restoreEvent(before));
          if (!planner.event(saved.id)) throw new Error(`Event "${saved.title}" is already gone.`);
          planner.deleteEvent(saved.id);
          return Promise.resolve(`Removed event "${saved.title}".`);
        },
      );
      return saved;
    },
    deleteEvent(id, date, scope) {
      const before = planner.event(id);
      const result = planner.deleteEvent(id, date, scope);
      if (before)
        journal.record(`Delete event "${before.title}"`, () =>
          Promise.resolve(restoreEvent(before)),
        );
      return result;
    },
  };
}

export function createUndoTool(journal: UndoJournal): Tool {
  return defineTool({
    name: 'undo_last_action',
    description:
      'Take back the last thing you (Jarvis) changed: a file you created, overwrote, moved, renamed or copied, a folder you made, or a task or calendar event you added, changed or deleted. Use it when sir says "undo that" or "put it back". It undoes one action per call, newest first, and never forces: if the thing changed since, it says so. Not for what sir did himself, and deleted files come back only from the Recycle Bin.',
    input: z.object({}).strict(),
    tier: 'CONFIRM',
    summarize: () => `Undo: ${journal.last()?.label ?? 'nothing to undo'}`,
    confirm: () => ({
      title: 'Undo this?',
      actionLabel: 'Undo',
      details: journal.last()?.label ?? 'There is nothing to undo.',
      detailsKind: 'text',
    }),
    async run() {
      const done = await journal.undoLast();
      if (!done)
        return ok('There is nothing to undo: you have changed nothing since Jarvis started.');
      return done.ok
        ? ok(`Undid "${done.label}". ${done.result}`)
        : fail(`Could not undo "${done.label}": ${done.result}`);
    },
  });
}
