import { useCallback, useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { SettingInput, SettingSwitch, SettingTextArea } from './settings-controls';

/** Dictation (ideas from isair/jarvis): speak, and Jarvis types it into the app in front. */
export function DictationSection(): React.JSX.Element {
  const hotkey = useSetting('hotkeys.dictation') ?? 'Ctrl+Alt+D';
  const [history, setHistory] = useState<Res<'dictation:history'>>([]);
  const load = useCallback(() => void call('dictation:history', {}).then(setHistory), []);
  useEffect(() => {
    load();
    return window.jarvis.on('dictation:done', load);
  }, [load]);
  return (
    <>
      <Section
        title="Dictation"
        description={`Press ${hotkey} in any app, speak, then pause (or press it again): Jarvis types what you said where your cursor is. Uses the speech-to-text engine chosen in Voice; on-device Whisper keeps it fully offline.`}
      >
        <SettingSwitch k="dictation.enabled" label="Turn on the dictation hotkey" />
        <SettingInput k="hotkeys.dictation" label="Dictation hotkey" />
        <SettingSwitch k="dictation.removeFillers" label="Remove filler words (um, uh, er)" />
        <SettingTextArea
          k="dictation.dictionary"
          label="Custom dictionary"
          hint='One fix per line: "heard => written", e.g. "jarvis => JARVIS" or "avan tech => AvaanTech".'
        />
        <SettingSwitch k="dictation.keepHistory" label="Keep a history of dictations on this PC" />
      </Section>
      <Section title="Dictation history">
        <div className="flex gap-2">
          <Button variant="ghost" onClick={load}>
            Refresh
          </Button>
          <Button variant="ghost" onClick={() => void call('dictation:clear', {}).then(load)}>
            Clear history
          </Button>
        </div>
        <ul className="flex max-w-2xl flex-col gap-1">
          {history.length === 0 && <li className="text-sm text-ink-500">Nothing dictated yet.</li>}
          {history.map((h) => (
            <li key={h.id} className="rounded-md border border-glass-border px-3 py-2 text-sm">
              <span className="block text-xs text-ink-500 tabular">
                {new Date(h.ts).toLocaleString()} {h.target_app ? `· ${h.target_app}` : ''}
              </span>
              <span className="text-ink-100">{h.final_text}</span>
              <button
                type="button"
                className="ml-2 text-xs text-reactor-500 underline"
                onClick={() => void navigator.clipboard.writeText(h.final_text)}
              >
                Copy
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
