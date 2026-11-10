// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { UiMessage } from '@shared/types';
import { ChatMessage } from './chat-message';
import { pastedName } from './composer';
import { followUps, timingLabel } from './reply-footer';

const msg = (m: Partial<UiMessage>): UiMessage => ({
  id: 'm1',
  role: 'assistant',
  text: '',
  createdAt: '2026-11-06T10:00:00Z',
  ...m,
});

const show = (m: UiMessage): void => {
  render(
    <Tooltip.Provider>
      <ChatMessage message={m} />
    </Tooltip.Provider>,
  );
};

afterEach(cleanup);

describe('chat messages (v2.62)', () => {
  it('copies a whole reply', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    show(msg({ text: 'Two **steps**: first, then second.' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy reply' })));
    expect(writeText).toHaveBeenCalledWith('Two **steps**: first, then second.');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('marks what Sir said out loud with a mic, and not what he typed', () => {
    show(msg({ role: 'user', text: 'what is the weather', source: 'voice' }));
    expect(screen.getByLabelText('Spoken')).toBeTruthy();
    cleanup();
    show(msg({ role: 'user', text: 'typed this', source: 'text' }));
    expect(screen.queryByLabelText('Spoken')).toBeNull();
  });
});

describe('pasted files', () => {
  it('names a pasted screenshot by time, and keeps real file names', () => {
    const at = new Date('2026-11-06T09:30:15Z');
    expect(pastedName({ name: 'image.png', type: 'image/png' }, at)).toBe(
      'pasted-2026-11-06-09-30-15.png',
    );
    expect(pastedName({ name: '', type: 'image/jpeg' }, at)).toBe(
      'pasted-2026-11-06-09-30-15.jpeg',
    );
    expect(pastedName({ name: 'report.pdf', type: 'application/pdf' }, at)).toBe('report.pdf');
  });
});

describe('reply footer (v2.63)', () => {
  it('reads a reply aloud through Jarvis, and stops when asked', async () => {
    const speak = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { call: { 'voice:speak': speak } };
    show(msg({ text: 'It is **sunny**, sir.' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Read aloud' })));
    expect(speak).toHaveBeenCalledWith({ action: 'start', text: 'It is **sunny**, sir.' });
  });

  it('shows how long the reply took', () => {
    show(msg({ text: 'Done.', timing: { firstWordMs: 1240, totalMs: 6400 } }));
    expect(screen.getByText('1.2 s to first word · 6.4 s')).toBeTruthy();
    expect(timingLabel({ firstWordMs: 900, totalMs: 1000 })).toBe('1.0 s');
    expect(timingLabel({ firstWordMs: 4000, totalMs: 26_400 })).toBe('4.0 s to first word · 26 s');
  });

  it('offers follow-ups under the latest reply only, "Do it" when it asked a question', async () => {
    const next = vi.fn();
    render(
      <Tooltip.Provider>
        <ChatMessage message={msg({ text: 'Shall I book it for Friday?' })} onFollowUp={next} />
      </Tooltip.Provider>,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Do it' })));
    expect(next).toHaveBeenCalledWith('Yes, do it.');
    expect(followUps('Here is the summary.').map((c) => c.label)).toEqual([
      'More detail',
      'Save to memory',
      'Add to tasks',
      'Save to Space',
    ]);
    // The calendar chip shows only when the reply names a time.
    expect(followUps('The dentist is free on Friday at 4 pm.').map((c) => c.label)).toContain(
      'Add to calendar',
    );
    cleanup();
    show(msg({ text: 'Shall I book it?' })); // not the latest: no chips
    expect(screen.queryByRole('button', { name: 'Do it' })).toBeNull();
  });
});
