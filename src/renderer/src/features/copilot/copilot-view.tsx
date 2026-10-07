import { useState } from 'react';
import clsx from 'clsx';
import { create } from 'zustand';
import type { EventPayload, Req, Res } from '@shared/ipc-contract';
import { PageBody, PageHeader } from '../../components/ui/page';
import { Button } from '../../components/ui/button';
import { Switch, TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { registerBridge } from '../../lib/ipc-bridge';
import { useSetting } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';

type Capture = EventPayload<'copilot:captured'>;
type Analysis = Res<'copilot:analyse'>;
type Candidate = Res<'copilot:draft'>[number];
type Scene = Req<'copilot:analyse'>['scene'];

/** The latest capture survives navigation (it may arrive from the hotkey while another view is open). */
export const useCopilotStore = create<{ capture: Capture | null; set(c: Capture | null): void }>(
  (set) => ({
    capture: null,
    set: (capture) => set({ capture }),
  }),
);
registerBridge((on) => [on('copilot:captured', (c) => useCopilotStore.getState().set(c))]);

const SCENES: Record<Scene, { label: string; relationships: Record<string, string> }> = {
  work: {
    label: 'Work',
    relationships: {
      senior: 'Manager / senior',
      peer: 'Colleague',
      report: 'Reports to me',
      client: 'Client / external',
    },
  },
  romance: { label: 'Romance', relationships: { partner: 'Partner', dating: 'Dating', ex: 'Ex' } },
  friends: { label: 'Friends', relationships: { close: 'Close friend', casual: 'Friend' } },
  family: {
    label: 'Family',
    relationships: { parent: 'Parent', sibling: 'Sibling', child: 'Child', relative: 'Relative' },
  },
  general: { label: 'General', relationships: { other: 'Someone else' } },
};

const STATE_LABEL: Record<Candidate['state'], string> = {
  eligible: 'Ready',
  confirm: 'Check 1 thing',
  blocked: 'Needs a rewrite',
};

/** Reply copilot (desktop take on jev-chat-jarvis): read → situation → stance → two checked drafts → paste. */
export function CopilotView(): React.JSX.Element {
  const capture = useCopilotStore((s) => s.capture);
  const setCapture = useCopilotStore((s) => s.set);
  const hotkey = useSetting('hotkeys.copilot') ?? 'Ctrl+Alt+R';
  const toast = useUiStore((s) => s.toast);
  const [scene, setScene] = useState<Scene>('friends');
  const [relationship, setRelationship] = useState('close');
  const [dispute, setDispute] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [option, setOption] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [drafts, setDrafts] = useState<Candidate[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const step = async <T,>(label: string, p: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    try {
      return await p();
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  const reset = (): void => {
    setAnalysis(null);
    setOption(null);
    setDrafts([]);
    setEdits({});
    setDetails('');
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Reply copilot" />
      <PageBody className="flex flex-col gap-6">
        <header>
          <p className="text-sm text-ink-300">
            Open a chat (WhatsApp, Telegram, Slack…) and press <b>{hotkey}</b>. Jarvis reads the
            conversation from a screenshot, works out what they want, helps you choose how to
            respond, drafts two replies and checks them. It pastes your pick into the message box.{' '}
            <b>You press Send.</b>
          </p>
        </header>

        {!capture ? (
          <p className="card p-4 text-sm text-ink-500">
            No chat captured yet. Press {hotkey} while the chat is on screen.
          </p>
        ) : (
          <>
            <section aria-label="Conversation" className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold text-ink-100">
                  {capture.chat.contact || 'Chat'}{' '}
                  <span className="text-sm text-ink-500">
                    · {capture.chat.app || capture.windowTitle}
                  </span>
                </p>
                <Button variant="ghost" onClick={() => (setCapture(null), reset())}>
                  Clear
                </Button>
              </div>
              <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {capture.chat.messages.map((m, i) => (
                  <li
                    key={i}
                    className={clsx(
                      'max-w-[80%] rounded-md px-3 py-1.5',
                      m.from === 'me'
                        ? 'self-end bg-selected text-ink-100'
                        : 'self-start bg-surface-2 text-ink-300',
                    )}
                  >
                    {m.text}
                  </li>
                ))}
              </ol>
            </section>

            <section aria-label="Who is this" className="flex flex-col gap-3">
              <h2 className="text-base font-semibold text-ink-100">1 · Who is this?</h2>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SCENES) as Scene[]).map((sc) => (
                  <Button
                    key={sc}
                    variant={scene === sc ? 'primary' : 'secondary'}
                    onClick={() => (
                      setScene(sc),
                      setRelationship(Object.keys(SCENES[sc].relationships)[0] ?? 'other'),
                      reset()
                    )}
                  >
                    {SCENES[sc].label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(SCENES[scene].relationships).map(([id, label]) => (
                  <Button
                    key={id}
                    variant={relationship === id ? 'primary' : 'ghost'}
                    onClick={() => (setRelationship(id), reset())}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <Switch
                label="We're in a disagreement / I'm being held to account"
                checked={dispute}
                onChange={(v) => (setDispute(v), reset())}
              />
              <Button
                variant="primary"
                disabled={busy !== null}
                onClick={() =>
                  void step('Reading the situation…', () =>
                    call('copilot:analyse', { id: capture.id, scene, relationship, dispute }),
                  ).then((a) => a && (setAnalysis(a), setOption(a.options[0]?.id ?? null)))
                }
              >
                {busy === 'Reading the situation…' ? busy : 'Analyse'}
              </Button>
            </section>

            {analysis && (
              <section aria-label="Situation" className="flex flex-col gap-3">
                <h2 className="text-base font-semibold text-ink-100">
                  2 · How do you want to respond?
                </h2>
                <div className="inset p-3 text-sm text-ink-300">
                  <p>
                    <b className="text-ink-100">They want:</b> {analysis.theyWant}
                  </p>
                  <p>
                    <b className="text-ink-100">Tone:</b> {analysis.tone} ·{' '}
                    <b className="text-ink-100">Pressure:</b> {analysis.pressure}
                  </p>
                  {analysis.boundaries.length > 0 && (
                    <p>
                      <b className="text-ink-100">Their boundaries:</b>{' '}
                      {analysis.boundaries.join('; ')}
                    </p>
                  )}
                  {analysis.friction.length > 0 && (
                    <p>
                      <b className="text-ink-100">Friction:</b> {analysis.friction.join('; ')}
                    </p>
                  )}
                </div>
                <div role="radiogroup" aria-label="Stance" className="grid gap-2 sm:grid-cols-2">
                  {analysis.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={option === o.id}
                      onClick={() => setOption(o.id)}
                      className={clsx(
                        'rounded-md border p-3 text-left',
                        option === o.id
                          ? 'border-accent-edge bg-selected'
                          : 'border-line hover:border-ink-500',
                      )}
                    >
                      <span className="block font-semibold text-ink-100">{o.label}</span>
                      <span className="mt-1 block text-sm text-ink-300">{o.stance}</span>
                      {o.needsDetail && (
                        <span className="mt-1 block text-xs text-lamp-400">
                          Add: {o.needsDetail}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <TextInput
                  aria-label="Details to include"
                  placeholder="Anything to include (a date, an amount, a reason)…"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={!option || busy !== null}
                  onClick={() =>
                    void step('Drafting and checking…', () =>
                      call('copilot:draft', { id: capture.id, optionId: option ?? '', details }),
                    ).then((d) => d && (setDrafts(d), setEdits({})))
                  }
                >
                  {busy === 'Drafting and checking…' ? busy : 'Draft two replies'}
                </Button>
              </section>
            )}

            {drafts.length > 0 && (
              <section aria-label="Drafts" className="flex flex-col gap-3">
                <h2 className="text-base font-semibold text-ink-100">3 · Pick a reply</h2>
                {drafts.map((d, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'rounded-md border p-3',
                      d.topPick
                        ? 'border-ok-400'
                        : d.state === 'blocked'
                          ? 'border-alarm-500'
                          : 'border-line',
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <span
                        className={clsx(
                          'font-semibold',
                          d.state === 'eligible'
                            ? 'text-ok-400'
                            : d.state === 'confirm'
                              ? 'text-lamp-400'
                              : 'text-alarm-500',
                        )}
                      >
                        {d.topPick ? 'Top pick' : STATE_LABEL[d.state]}
                      </span>
                      <span className="text-ink-500 tabular">{d.score.toFixed(1)} / 5</span>
                    </div>
                    <textarea
                      aria-label={`Reply ${i + 1}`}
                      rows={3}
                      value={edits[i] ?? d.text}
                      onChange={(e) => setEdits({ ...edits, [i]: e.target.value })}
                      className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-100"
                    />
                    {d.problems.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-ink-300">
                        {d.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {d.note && <p className="mt-1 text-xs text-ink-500">{d.note}</p>}
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant={d.state === 'blocked' ? 'secondary' : 'primary'}
                        disabled={busy !== null}
                        onClick={() =>
                          void step('Pasting…', () =>
                            call('copilot:fill', { id: capture.id, text: edits[i] ?? d.text }),
                          ).then(
                            (r) =>
                              r &&
                              (toast({
                                level: 'info',
                                message: 'Pasted into the chat. Review it and press Send.',
                              }),
                              setCapture(null),
                              reset()),
                          )
                        }
                      >
                        Paste into chat
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void navigator.clipboard.writeText(edits[i] ?? d.text)}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </PageBody>
    </div>
  );
}
