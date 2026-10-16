import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Req, Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section, Switch, TextInput } from '../../components/ui/field';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call, cleanError } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';
import { useUiStore } from '../../stores/ui-store';
import { AUTOMATION_TEMPLATES } from '@shared/automation-templates';
import { ScheduleEditor } from './schedule-editor';
import { SettingTextArea } from './settings-controls';

type Task = Res<'tasks:list'>[number];
type TaskInput = Req<'tasks:save'>;

const KINDS: Record<TaskInput['kind'], string> = {
  briefing: 'Briefing (digest)',
  task: 'Task (do and report)',
  checkin: 'Check-in (only if worth saying)',
};

const blank = (): TaskInput => ({
  name: '',
  kind: 'task',
  prompt: '',
  schedule: { type: 'daily', time: '09:00', days: [] },
  enabled: true,
  speak: false,
  saveToVault: false,
});

const toInput = (t: Task): TaskInput => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  prompt: t.prompt,
  schedule: t.schedule,
  enabled: t.enabled,
  speak: t.speak,
  saveToVault: t.saveToVault,
});

function TaskEditor({
  initial,
  onDone,
}: {
  initial: TaskInput;
  onDone(): void;
}): React.JSX.Element {
  const [t, setT] = useState<TaskInput>(initial);
  const toast = useUiStore((s) => s.toast);
  const save = (): void =>
    void call('tasks:save', t)
      .then(onDone)
      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }));
  return (
    <div className="flex flex-col gap-3 card border-accent-edge p-4">
      <TextInput
        aria-label="Task name"
        placeholder="Name, e.g. Weekly review"
        value={t.name}
        onChange={(e) => setT({ ...t, name: e.target.value })}
      />
      <label className="flex items-center gap-2 text-sm text-ink-300">
        Kind
        <select
          value={t.kind}
          onChange={(e) => setT({ ...t, kind: e.target.value as TaskInput['kind'] })}
          className="min-h-8 rounded-md border border-line bg-surface-2 px-2 text-ink-100"
        >
          {Object.entries(KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <textarea
        aria-label="What should Jarvis do"
        rows={3}
        placeholder="What should Jarvis do each time? e.g. Summarise my week from my daily logs and list open reminders."
        value={t.prompt}
        onChange={(e) => setT({ ...t, prompt: e.target.value })}
        className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-100"
      />
      <ScheduleEditor value={t.schedule} onChange={(schedule) => setT({ ...t, schedule })} />
      <Switch
        label="Speak the result (when voice is on)"
        checked={t.speak}
        onChange={(v) => setT({ ...t, speak: v })}
      />
      <Switch
        label="Save the result to Obsidian (Briefings/)"
        checked={t.saveToVault}
        onChange={(v) => setT({ ...t, saveToVault: v })}
      />
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={t.name.length < 2 || t.prompt.length < 5}
          onClick={save}
        >
          Save
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Scheduled agents (ideas from OpenJarvis): morning briefing, recurring tasks, proactive check-ins. */
export function AutomationsSection(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editing, setEditing] = useState<TaskInput | null>(null);
  const toast = useUiStore((s) => s.toast);
  const load = useCallback(() => void call('tasks:list', {}).then(setTasks), []);
  useEffect(() => {
    load();
    return window.jarvis.on('tasks:changed', load);
  }, [load]);
  const save = (t: Task, patch: Partial<TaskInput>): void =>
    void call('tasks:save', { ...toInput(t), ...patch }).then(load);
  const openConversation = (id: string | null): void => {
    if (!id) return;
    void useChatStore
      .getState()
      .open(id)
      .then(() => useUiStore.getState().go('chat'))
      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }));
  };
  return (
    <>
      <Section
        title="Automations"
        description="Things Jarvis does by itself on a schedule while it is running: a morning briefing, recurring tasks, or proactive check-ins that only speak up when something is worth saying. Each run is a normal conversation; actions that need your OK still ask. You can also say “every Friday at 5 pm summarise my week”."
      >
        <ul className="flex max-w-3xl flex-col gap-2">
          {tasks.map((t) =>
            editing?.id === t.id ? (
              <li key={t.id}>
                <TaskEditor initial={editing} onDone={() => (setEditing(null), load())} />
              </li>
            ) : (
              <li
                key={t.id}
                className={clsx(
                  'inset flex flex-wrap items-start gap-3 rounded-lg p-4 transition-colors duration-[160ms]',
                  !t.enabled && 'opacity-75',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-ink-100">
                    <span
                      className={clsx(
                        'size-2 shrink-0 rounded-pill',
                        t.enabled ? 'bg-ok-400' : 'bg-ink-500',
                      )}
                      aria-hidden
                    />
                    {t.name}
                  </p>
                  <p className="text-sm text-ink-300">
                    {KINDS[t.kind]} · {t.scheduleText}
                    {t.speak ? ' · spoken' : ''}
                    {t.saveToVault ? ' · saved to Obsidian' : ''}
                  </p>
                  <p className="mt-1 text-xs text-ink-500 tabular">
                    {t.enabled && t.nextRunAt
                      ? `Next: ${new Date(t.nextRunAt).toLocaleString()}`
                      : 'Off'}
                    {t.lastRunAt
                      ? ` · Last: ${new Date(t.lastRunAt).toLocaleString()} (${t.lastStatus ?? ''})`
                      : ''}
                  </p>
                </div>
                <Switch
                  label={`Run ${t.name} on schedule`}
                  checked={t.enabled}
                  onChange={(v) => save(t, { enabled: v })}
                />
                <Button
                  variant="ghost"
                  onClick={() =>
                    void call('tasks:runNow', { id: t.id })
                      .then((r) => openConversation(r.conversationId))
                      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
                  }
                >
                  Run now
                </Button>
                {t.lastConversationId && (
                  <Button variant="ghost" onClick={() => openConversation(t.lastConversationId)}>
                    Last result
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setEditing({ ...t })}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  title="Make a copy to change"
                  onClick={() => {
                    const { id: _id, ...rest } = toInput(t);
                    setEditing({ ...rest, name: `${t.name} (copy)`.slice(0, 60), enabled: false });
                  }}
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void confirmAction({
                      title: `Delete "${t.name}"?`,
                      body: 'It will stop running. Past results stay in your conversations.',
                      actionLabel: 'Delete',
                      destructive: true,
                    }).then((yes) => yes && call('tasks:delete', { id: t.id }).then(load))
                  }
                >
                  Delete
                </Button>
              </li>
            ),
          )}
        </ul>
        {editing && !editing.id ? (
          <div id="new-automation">
            <TaskEditor
              key={editing.name}
              initial={editing}
              onDone={() => (setEditing(null), load())}
            />
          </div>
        ) : (
          <Button variant="primary" className="self-start" onClick={() => setEditing(blank())}>
            New automation
          </Button>
        )}
      </Section>
      <Section
        title="Templates"
        description="Ready-made automations. Pick one, adjust it, and save."
      >
        <ul className="grid max-w-3xl gap-2 sm:grid-cols-2">
          {AUTOMATION_TEMPLATES.map((tpl) => {
            const added = tasks.some((t) => t.name === tpl.name);
            return (
              <li key={tpl.id} className="inset flex flex-col gap-2 rounded-lg p-3">
                <p className="font-semibold text-ink-100">{tpl.name}</p>
                <p className="flex-1 text-sm text-ink-300">{tpl.blurb}</p>
                <Button
                  variant="secondary"
                  className="self-start"
                  disabled={added}
                  onClick={() => {
                    const { id: _tplId, blurb: _blurb, ...input } = tpl;
                    setEditing({ ...input, enabled: true });
                    requestAnimationFrame(() =>
                      document
                        .getElementById('new-automation')
                        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
                    );
                  }}
                >
                  {added ? 'Added' : 'Use this'}
                </Button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section
        title="News feeds"
        description="Used by read_feed and the morning briefing. One per line: Name | https://feed-url (RSS or Atom)."
      >
        <SettingTextArea k="feeds.list" label="Feeds" />
      </Section>
    </>
  );
}
