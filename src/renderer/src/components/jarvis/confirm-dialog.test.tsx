// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useConfirmStore, type ConfirmRequest } from '../../stores/confirm-store';
import { ConfirmDialog } from './confirm-dialog';
import { Orb } from './orb';

const respond = vi.fn(async () => ({ ok: true }));

beforeEach(() => {
  respond.mockClear();
  (window as unknown as { jarvis: unknown }).jarvis = {
    call: { 'confirm:respond': respond },
    on: () => () => undefined,
    send: {},
  };
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as never;
});
afterEach(() => {
  cleanup();
  act(() => useConfirmStore.setState({ current: null }));
});

function request(over: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return {
    requestId: 'cf_1',
    toolName: 'delete_to_recycle_bin',
    title: 'Move 14 items to the Recycle Bin?',
    humanSummary: 'Move 14 items to the Recycle Bin',
    details: Array.from({ length: 14 }, (_, i) => `• C:\\Users\\Sir\\Downloads\\file${i}.zip`).join(
      '\n',
    ),
    detailsKind: 'paths',
    actionLabel: 'Move to Recycle Bin',
    destructive: true,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    queuePosition: 1,
    queueTotal: 1,
    ...over,
  };
}

function show(r: ConfirmRequest): void {
  render(
    <Tooltip.Provider>
      <ConfirmDialog />
    </Tooltip.Provider>,
  );
  act(() => useConfirmStore.getState().show(r));
}

describe('ConfirmDialog (Design-system.md §5.5)', () => {
  it('destructive: alertdialog, action-named red button, focus starts on Cancel', () => {
    show(request());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move to Recycle Bin' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(screen.getByText(/Show the 14 items/)).toBeTruthy();
  });

  it('destructive: Enter does not approve; Ctrl+Enter does', () => {
    show(request());
    const dialog = screen.getByRole('alertdialog');
    const approve = screen.getByRole('button', { name: 'Move to Recycle Bin' });
    approve.focus();
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(respond).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true });
    expect(respond).toHaveBeenCalledWith({
      requestId: 'cf_1',
      decision: 'approve',
      via: 'keyboard',
    });
  });

  it('non-destructive: focus starts on the primary action', () => {
    show(
      request({
        destructive: false,
        title: 'Create folder "Invoices"?',
        actionLabel: 'Create folder',
        detailsKind: 'paths',
        details: 'C:\\x\\Invoices',
      }),
    );
    expect(document.activeElement?.textContent).toBe('Create folder');
  });

  it('Escape denies', () => {
    show(request({ destructive: false }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(respond).toHaveBeenCalledWith({ requestId: 'cf_1', decision: 'deny', via: 'keyboard' });
  });

  it('shows the full PowerShell script with line numbers and the taint banner', () => {
    show(
      request({
        destructive: false,
        detailsKind: 'code',
        details: 'Get-Process\nSort-Object WS',
        purpose: 'List top processes',
        taintedFrom: 'mcp:playwright',
      }),
    );
    expect(screen.getByText('Get-Process')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(/Suggested after reading mcp:playwright/)).toBeTruthy();
    expect(screen.getByText(/Jarvis wants to list top processes/)).toBeTruthy();
  });

  it('shows a countdown in the last 20 seconds and the queue position', () => {
    show(
      request({
        expiresAt: new Date(Date.now() + 15_000).toISOString(),
        queuePosition: 1,
        queueTotal: 3,
      }),
    );
    expect(screen.getByText(/Cancels automatically in 1[45] s/)).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });
});

describe('Orb (Design-system.md §5.1)', () => {
  it.each([
    'IDLE',
    'LISTENING',
    'THINKING',
    'ACTING',
    'AWAITING_CONFIRMATION',
    'SPEAKING',
    'ERROR',
    'SLEEP',
  ] as const)('renders %s with an accessible label', (state) => {
    render(<Orb state={state} size="md" level={0.2} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('data-state')).toBe(state);
    expect(img.getAttribute('aria-label')).toMatch(/^Jarvis is /);
  });

  it('turns off animation classes under reduced motion', () => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as never;
    const { container } = render(<Orb state="THINKING" size="sm" />);
    expect(container.querySelector('.orb-orbit')).toBeNull();
  });
});
