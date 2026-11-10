// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/jarvis/rail', () => ({
  NAV_ITEMS: [
    { view: 'tasks', label: 'Tasks' },
    { view: 'memory', label: 'Memory' },
  ],
}));
vi.mock('../settings/sections', () => ({
  SETTINGS_SECTIONS: [{ id: 'voice', label: 'Voice', keywords: 'microphone' }],
}));
const call = vi.fn<(channel: string, req: { query?: string }) => Promise<unknown>>();
vi.mock('../../lib/api', () => ({
  call: (channel: string, req: { query?: string }) => call(channel, req),
}));

import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { Palette } from './palette';

const openPalette = async (): Promise<HTMLElement> => {
  await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
  return screen.getByRole('combobox');
};
const type = async (box: HTMLElement, value: string): Promise<void> => {
  await act(async () => fireEvent.change(box, { target: { value } }));
};

beforeEach(() => {
  vi.useFakeTimers();
  call.mockImplementation(async (channel: string, req: { query?: string }) =>
    channel === 'memory:search' && req.query === 'priya'
      ? [{ vaultPath: 'Memory/People/Priya.md', title: 'Priya', snippet: 'works at Avaan' }]
      : [],
  );
  useSettingsStore.setState({ values: { 'onboarding.complete': true } });
  useUiStore.setState({ view: 'chat', memoryTarget: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('command palette (Ctrl+K)', () => {
  it('opens on Ctrl+K as a menu and closes on Ctrl+K again', async () => {
    render(<Palette />);
    expect(screen.queryByRole('combobox')).toBeNull();
    await openPalette();
    expect(screen.getByRole('option', { name: 'Go to: Tasks' })).toBeTruthy();
    await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('jumps to a setting found by a keyword, with Enter', async () => {
    render(<Palette />);
    const box = await openPalette();
    await type(box, 'microphone');
    await act(async () => fireEvent.keyDown(box, { key: 'Enter' }));
    expect(useUiStore.getState().view).toBe('settings');
    expect(useUiStore.getState().settingsSection).toBe('voice');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('opens a memory note found by the main-process search, with the arrow keys', async () => {
    render(<Palette />);
    const box = await openPalette();
    await type(box, 'priya');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(call).toHaveBeenCalledWith('memory:search', { query: 'priya' });
    const hit = screen.getByRole('option', { name: 'Memory: Priya' });
    await act(async () => fireEvent.keyDown(box, { key: 'ArrowUp' })); // wraps to the last result
    expect(hit.getAttribute('aria-selected')).toBe('true');
    await act(async () => fireEvent.keyDown(box, { key: 'Enter' }));
    expect(useUiStore.getState().view).toBe('memory');
    expect(useUiStore.getState().memoryTarget).toBe('Memory/People/Priya.md');
  });

  it('says so when nothing matches', async () => {
    render(<Palette />);
    const box = await openPalette();
    await type(box, 'zzzz');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText(/Nothing found/)).toBeTruthy();
  });
});
