import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import clsx from 'clsx';
import { call, cleanError } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';
import { useUiStore } from '../../stores/ui-store';
import { IconButton } from '../ui/button';

/** Quiet time after the last spoken word before the message goes (Sir can also tap to send now). */
export const SEND_PAUSE_MS = 2000;

interface VoiceSendOptions {
  /** What is in the box now; spoken words are added after it. */
  text: string;
  setText: (text: string) => void;
  /** Sends the finished message (the box text plus what was said). */
  onSend: (text: string) => void;
}

/**
 * Speak-to-send for the Forge and NPC chats (2.56). Uses the same dictation as Jarvis's own message
 * box (voice:compose: words stream in as Sir speaks), but ends after a short pause, or a tap on the
 * mic, and then sends by itself. If nothing was said, nothing is sent and the box is left as it was.
 */
export function useVoiceSend(o: VoiceSendOptions): { live: boolean; toggle: () => void } {
  const [live, setLive] = useState(false);
  const toast = useUiStore((s) => s.toast);
  /** The box text when the mic was tapped; null when this box isn't dictating. */
  const base = useRef<string | null>(null);
  const heard = useRef(false);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });

  const end = (): void => {
    clearTimeout(pause.current);
    base.current = null;
    heard.current = false;
    setLive(false);
  };

  useEffect(
    () =>
      window.jarvis.on('voice:compose', (p) => {
        const b = base.current;
        if (b === null) return; // Another box (or nobody) is dictating.
        const said = p.text.trim();
        const full = said ? `${b}${b && !/\s$/.test(b) ? ' ' : ''}${said}` : b;
        opts.current.setText(full);
        if (said) heard.current = true;
        if (p.final) {
          const send = heard.current && full.trim();
          end();
          if (send) opts.current.onSend(full.trim());
          return;
        }
        if (said) {
          clearTimeout(pause.current);
          pause.current = setTimeout(
            () => void call('voice:compose', { action: 'stop' }).catch(() => undefined),
            SEND_PAUSE_MS,
          );
        }
      }),
    [],
  );

  // Listening can also end without a final message (cancelled, or a long silence with no words).
  const composing = useAssistantStore((s) => s.state === 'LISTENING' && s.detail === 'compose');
  const seen = useRef(false);
  useEffect(() => {
    if (composing) seen.current = true;
    else if (seen.current) {
      seen.current = false;
      if (base.current !== null) end();
    }
  }, [composing]);

  // Leaving the page mid-sentence stops the mic and sends nothing.
  useEffect(
    () => () => {
      clearTimeout(pause.current);
      if (base.current !== null) {
        base.current = null;
        void call('voice:compose', { action: 'stop' }).catch(() => undefined);
      }
    },
    [],
  );

  const toggle = (): void => {
    if (base.current !== null) {
      clearTimeout(pause.current);
      void call('voice:compose', { action: 'stop' }).catch(() => undefined); // its final sends
      return;
    }
    base.current = opts.current.text;
    heard.current = false;
    setLive(true);
    call('voice:compose', { action: 'start' }).catch((err: unknown) => {
      end();
      toast({ level: 'error', message: cleanError(err), action: 'settings:voice' });
    });
  };

  return { live, toggle };
}

/** The mic beside a chat box: tap, speak, and the message sends when you pause. */
export function VoiceSendButton({
  live,
  onClick,
  disabled,
}: {
  live: boolean;
  onClick: () => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  return (
    <IconButton
      label={live ? 'Stop and send' : 'Speak a message'}
      hint={live ? 'Sends now' : 'Speak; it sends when you pause'}
      active={live}
      disabled={disabled && !live}
      // §6.2: while recording the mic turns blue and a ring breathes out of it.
      className={clsx('relative', live && 'mic-live text-accent-300!')}
      onClick={onClick}
    >
      <Mic size={16} strokeWidth={1.75} aria-hidden />
    </IconButton>
  );
}
