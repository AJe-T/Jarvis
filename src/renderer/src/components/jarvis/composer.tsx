import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Mic, Paperclip, Send, Square, X } from 'lucide-react';
import clsx from 'clsx';
import { call } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';
import { useChatStore, type Attachment } from '../../stores/chat-store';
import { useSetting } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { IconButton } from '../ui/button';

const MAX_BYTES = 10 * 1024 * 1024;
const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'] as const;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () =>
      resolve((typeof r.result === 'string' ? r.result : '').replace(/^data:[^,]+,/, ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/** Design-system.md §5.2. */
export function Composer(): React.JSX.Element {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const live = useChatStore((s) => s.live);
  const send = useChatStore((s) => s.send);
  const cancel = useChatStore((s) => s.cancel);
  const draft = useChatStore((s) => s.draft);
  const takeDraft = useChatStore((s) => s.takeDraft);
  // Rewind → edit puts the old message back here.
  useEffect(() => {
    const d = draft === null ? null : takeDraft();
    if (d !== null) setText(d);
  }, [draft, takeDraft]);
  const state = useAssistantStore((s) => s.state);
  const transcript = useAssistantStore((s) => s.transcript);
  const voiceMode = useSetting('voice.mode');
  const pttKey = useSetting('hotkeys.ptt') ?? 'Ctrl+Alt+Space';
  const online = useUiStore((s) => s.online);
  const toast = useUiStore((s) => s.toast);
  const busy = live !== null;
  const listening = state === 'LISTENING';

  async function submit(): Promise<void> {
    const t = text.trim();
    if (!t || busy) return;
    if (!online) {
      toast({
        level: 'warn',
        message: "You're offline. I'll be able to help once the connection is back.",
      });
      return;
    }
    setText('');
    const files = attachments;
    setAttachments([]);
    await send(t, 'text', files);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  async function onFiles(list: FileList | null): Promise<void> {
    for (const f of Array.from(list ?? [])) {
      const mime = MIMES.find((m) => m === f.type);
      if (!mime) {
        toast({ level: 'warn', message: `${f.name}: only images and PDFs can be attached.` });
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast({ level: 'warn', message: `${f.name} is larger than 10 MB.` });
        continue;
      }
      const dataBase64 = await readAsBase64(f);
      setAttachments((a) => [...a, { name: f.name, mime, dataBase64 }].slice(0, 5));
    }
  }

  return (
    <div className="w-full">
      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {attachments.map((a, i) => (
            <li
              key={`${a.name}-${i}`}
              className="inset flex items-center gap-1.5 py-1 pr-2 pl-3 text-sm text-ink-300"
            >
              {a.name}
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className="composer flex min-h-[52px] items-end gap-1 p-1.5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFiles(e.dataTransfer.files);
        }}
      >
        <textarea
          aria-label="Message Jarvis"
          placeholder={listening && transcript ? transcript.text : 'Message Jarvis…'}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-base text-ink-100 focus:outline-none focus-visible:outline-none short:max-h-24"
          style={{ fieldSizing: 'content' }}
        />
        <IconButton
          label={listening ? 'Stop listening' : 'Talk to Jarvis'}
          hint={pttKey}
          active={listening}
          // §6.2: while recording the mic turns blue and a ring breathes out of it.
          className={clsx('relative', listening && 'mic-live text-accent-300!')}
          disabled={voiceMode === 'off' || voiceMode === undefined}
          onClick={() => void call('voice:mic', { action: listening ? 'stop' : 'start' })}
        >
          <Mic size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton label="Attach image or PDF" onClick={() => fileRef.current?.click()}>
          <Paperclip size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept={MIMES.join(',')}
          onChange={(e) => void onFiles(e.target.files).then(() => (e.target.value = ''))}
        />
        {busy ? (
          <IconButton label="Stop" onClick={() => void cancel()} className="text-alarm-500">
            <Square size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        ) : (
          <IconButton
            label="Send"
            hint="Enter"
            disabled={!text.trim()}
            className={clsx(
              text.trim() && 'bg-accent-600! text-ink-on-accent! hover:brightness-110',
            )}
            onClick={() => void submit()}
          >
            <Send size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        )}
      </div>
      {voiceMode === 'wake' && (
        <p className="mt-1.5 text-xs text-ink-500">Say &lsquo;Jarvis&rsquo; or press {pttKey}</p>
      )}
      {voiceMode === 'ptt' && <p className="mt-1.5 text-xs text-ink-500">Press {pttKey} to talk</p>}
    </div>
  );
}
