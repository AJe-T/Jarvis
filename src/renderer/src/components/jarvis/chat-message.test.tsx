// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { UiMessage } from '@shared/types';
import { ChatMessage } from './chat-message';
import { pastedName } from './composer';

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
