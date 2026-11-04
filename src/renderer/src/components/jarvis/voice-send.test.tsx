// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useUiStore } from '../../stores/ui-store';
import { SEND_PAUSE_MS, useVoiceSend, VoiceSendButton } from './voice-send';

type Compose = { text: string; final: boolean };
let listeners: ((p: Compose) => void)[] = [];
const compose = vi.fn(async (_req: { action: 'start' | 'stop' }) => ({ ok: true }));
const sent = vi.fn();

function emit(p: Compose): void {
  act(() => listeners.forEach((l) => l(p)));
}

function Box({ initial = '' }: { initial?: string }): React.JSX.Element {
  const [text, setText] = useState(initial);
  const voice = useVoiceSend({ text, setText, onSend: (t) => void sent(t) });
  return (
    <Tooltip.Provider>
      <textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />
      <VoiceSendButton live={voice.live} onClick={voice.toggle} />
    </Tooltip.Provider>
  );
}

const box = (): HTMLTextAreaElement => screen.getByLabelText('Message');

beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  compose.mockClear();
  compose.mockImplementation(async () => ({ ok: true }));
  sent.mockClear();
  (window as unknown as { jarvis: unknown }).jarvis = {
    call: { 'voice:compose': compose },
    on: (channel: string, fn: (p: Compose) => void) => {
      if (channel !== 'voice:compose') return () => undefined;
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((l) => l !== fn);
      };
    },
    send: {},
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('speak-to-send mic for the Forge and NPC chats (2.56)', () => {
  it('streams words into the box, stops after a pause, then sends what was said', async () => {
    render(<Box />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    expect(compose).toHaveBeenCalledWith({ action: 'start' });
    expect(screen.getByRole('button', { name: 'Stop and send' })).toBeTruthy();

    emit({ text: 'learn to convert', final: false });
    expect(box().value).toBe('learn to convert');
    emit({ text: 'learn to convert currencies', final: false });
    expect(box().value).toBe('learn to convert currencies');

    // Still talking: no stop yet; quiet for the pause: the mic is told to stop.
    await act(() => vi.advanceTimersByTimeAsync(SEND_PAUSE_MS - 100));
    expect(compose).not.toHaveBeenCalledWith({ action: 'stop' });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(compose).toHaveBeenCalledWith({ action: 'stop' });

    emit({ text: 'learn to convert currencies', final: true });
    expect(sent).toHaveBeenCalledWith('learn to convert currencies');
    expect(screen.getByRole('button', { name: 'Speak a message' })).toBeTruthy();
  });

  it('adds spoken words after what was already typed', () => {
    render(<Box initial="@Ava" />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    emit({ text: 'please review the PR', final: true });
    expect(sent).toHaveBeenCalledWith('@Ava please review the PR');
  });

  it('tapping again stops listening, and the final words send', () => {
    render(<Box />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    emit({ text: 'hello team', final: false });
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send' }));
    expect(compose).toHaveBeenLastCalledWith({ action: 'stop' });
    expect(sent).not.toHaveBeenCalled();
    emit({ text: 'hello team', final: true });
    expect(sent).toHaveBeenCalledWith('hello team');
  });

  it('sends nothing when nothing was said, and keeps the typed text', () => {
    render(<Box initial="draft" />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    emit({ text: '', final: true });
    expect(sent).not.toHaveBeenCalled();
    expect(box().value).toBe('draft');
  });

  it("ignores dictation it didn't start (Jarvis's own message box)", () => {
    render(<Box />);
    emit({ text: 'meant for Jarvis', final: true });
    expect(sent).not.toHaveBeenCalled();
    expect(box().value).toBe('');
  });

  it('a mic that will not start shows the error and goes back to idle', async () => {
    const toast = vi.spyOn(useUiStore.getState(), 'toast');
    compose.mockImplementation(async () => {
      throw new Error('No speech engine is set up.');
    });
    render(<Box />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', message: 'No speech engine is set up.' }),
    );
    expect(screen.getByRole('button', { name: 'Speak a message' })).toBeTruthy();
  });
});
