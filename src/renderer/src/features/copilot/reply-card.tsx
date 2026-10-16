import { useState } from 'react';
import clsx from 'clsx';
import type { Req } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call } from '../../lib/api';

type How = Req<'copilot:refine'>['how'];

const REFINES: Array<[How, string]> = [
  ['shorter', 'Shorter'],
  ['warmer', 'Warmer'],
  ['firmer', 'Firmer'],
  ['formal', 'Formal'],
  ['casual', 'Casual'],
  ['emoji', '+ Emoji'],
];

/**
 * One reply Sir may send: editable, rewritable (shorter, warmer, another language…), then pasted
 * into the chat or copied. Jarvis never presses Send.
 */
export function ReplyCard({
  captureId,
  text,
  onText,
  busy,
  step,
  onPaste,
  header,
  footer,
  tone = 'plain',
}: {
  captureId: string;
  text: string;
  onText(text: string): void;
  busy: boolean;
  step<T>(label: string, p: () => Promise<T>): Promise<T | undefined>;
  onPaste(text: string): void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: 'plain' | 'top' | 'blocked';
}): React.JSX.Element {
  const [language, setLanguage] = useState('');
  const refine = (how: How): void =>
    void step('Rewriting…', () =>
      call('copilot:refine', {
        id: captureId,
        text,
        how,
        ...(how === 'translate' ? { language } : {}),
      }),
    ).then((r) => r && onText(r.text));

  return (
    <div
      className={clsx(
        'rounded-md border p-3',
        tone === 'top' ? 'border-ok-400' : tone === 'blocked' ? 'border-alarm-500' : 'border-line',
      )}
    >
      {header}
      <textarea
        aria-label="Reply"
        rows={3}
        value={text}
        onChange={(e) => onText(e.target.value)}
        className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-100"
      />
      {footer}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Rewrite">
        {REFINES.map(([how, label]) => (
          <Button
            key={how}
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={() => refine(how)}
          >
            {label}
          </Button>
        ))}
        <TextInput
          aria-label="Translate into"
          placeholder="Language…"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="h-7 min-h-7 w-28 text-xs"
        />
        <Button
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy || !language.trim()}
          onClick={() => refine('translate')}
        >
          Translate
        </Button>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          variant={tone === 'blocked' ? 'secondary' : 'primary'}
          disabled={busy || !text.trim()}
          onClick={() => onPaste(text)}
        >
          Paste into chat
        </Button>
        <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(text)}>
          Copy
        </Button>
      </div>
    </div>
  );
}
