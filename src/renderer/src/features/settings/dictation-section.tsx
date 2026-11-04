import { useCallback, useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useDraftSetting } from '../../stores/settings-store';
import { SettingInput, SettingSwitch, SettingTextArea } from './settings-controls';

/** Dictation (ideas from isair/jarvis): speak, and Jarvis types it into the app in front. */
export function DictationSection(): React.JSX.Element {
  const hotkey = useDraftSetting('hotkeys.dictation') ?? 'Ctrl+Alt+D';
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
        <SettingSwitch
          k="dictation.holdToTalk"
          label="Hold to talk: hold the hotkey while you speak, let go to type it (pauses don't end it)"
        />
        <SettingSwitch k="dictation.removeFillers" label="Remove filler words (um, uh, er)" />
        <SettingTextArea
          k="dictation.dictionary"
          label="Custom dictionary"
          hint='One fix per line: "heard => written", e.g. "jarvis => JARVIS" or "avan tech => AvaanTech". A line with just a name ("Priyanka") adds it to the vocabulary. With Deepgram (English), every written word is sent as a word to expect, so names are heard right the first time.'
        />
        <SettingSwitch k="dictation.keepHistory" label="Keep a history of dictations on this PC" />
      </Section>
      <Section
        title="Meetings"
        description='Say "record this meeting" (asks first: everyone should agree). Your microphone (You) and the PC’s sound (Them) are transcribed on this PC with the on-device speech model; only the words are kept. "Stop the meeting" saves the transcript, a summary and action items to the vault’s Meetings folder. Use headphones for the cleanest "You" track.'
      >
        <SettingSwitch
          k="meetings.addTasks"
          label="Add the meeting's action items to Tasks (#meeting)"
        />
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
            <li key={h.id} className="rounded-md border border-line px-3 py-2 text-sm">
              <span className="block text-xs text-ink-500 tabular">
                {new Date(h.ts).toLocaleString()} {h.target_app ? `· ${h.target_app}` : ''}
              </span>
              <span className="text-ink-100">{h.final_text}</span>
              <button
                type="button"
                className="ml-2 text-xs text-accent-300 underline"
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
