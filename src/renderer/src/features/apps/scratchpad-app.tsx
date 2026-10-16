import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useSetting, useSettingsStore } from '../../stores/settings-store';

const SAVE_AFTER_MS = 600;
const MAX = 20_000;

/** Notes Sir and Jarvis share ("Jarvis, put this on the scratchpad"). Saves as you type. */
export function ScratchpadApp(): React.JSX.Element {
  const saved = useSetting('apps.scratchpad') ?? '';
  const [text, setText] = useState(saved);
  const [state, setState] = useState<'saved' | 'saving'>('saved');
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Jarvis added something while Sir isn't typing: show it.
  useEffect(() => {
    if (!editing.current) setText(saved);
  }, [saved]);

  const save = (value: string): void => {
    if (timer.current) clearTimeout(timer.current);
    setState('saving');
    timer.current = setTimeout(() => {
      editing.current = false;
      void useSettingsStore
        .getState()
        .set('apps.scratchpad', value.slice(0, MAX))
        .finally(() => setState('saved'));
    }, SAVE_AFTER_MS);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section aria-label="Scratchpad" className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-ink-100">Scratchpad</h2>
        <span className="text-xs text-ink-500">
          {state === 'saving' ? 'Saving…' : 'Saved'} · {text.length.toLocaleString()} /{' '}
          {MAX.toLocaleString()}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(text)}>
          Copy all
        </Button>
        <Button
          variant="ghost"
          disabled={!text}
          onClick={() => {
            setText('');
            save('');
          }}
        >
          Clear
        </Button>
      </div>
      <textarea
        aria-label="Scratchpad text"
        value={text}
        maxLength={MAX}
        rows={18}
        placeholder="Jot anything here. Say “Jarvis, add this to my scratchpad” and it lands here too."
        onChange={(e) => {
          editing.current = true;
          setText(e.target.value);
          save(e.target.value);
        }}
        className="min-h-80 w-full resize-y rounded-md border border-line bg-surface-2 px-3 py-2 font-code text-sm text-ink-100"
      />
    </section>
  );
}
