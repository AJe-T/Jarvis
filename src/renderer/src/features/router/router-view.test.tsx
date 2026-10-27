// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import { PRIVATE_SOURCES } from '@shared/free-pool';
import { previewSnapshot } from './preview';
import { RouterView } from './router-view';

beforeEach(() => {
  (window as unknown as { jarvis: unknown }).jarvis = {
    call: {},
    on: () => () => undefined,
    send: {},
  };
});
afterEach(cleanup);

function renderView(): void {
  render(
    <Tooltip.Provider>
      <RouterView />
    </Tooltip.Provider>,
  );
}

describe('preview data', () => {
  const snap = previewSnapshot(0);

  it('gives every route a provider that exists, in that provider’s tier', () => {
    for (const m of snap.models)
      for (const r of m.routes) {
        const p = snap.providers.find((x) => x.id === r.providerId);
        expect(p, `${m.id} → ${r.providerId}`).toBeDefined();
        expect(r.tier).toBe(p?.tier);
      }
  });

  it('never puts a free provider in tier 1 (tier 1 is Claude and this PC)', () => {
    expect(snap.providers.every((p) => p.tier !== 1)).toBe(true);
  });

  it('is marked as a preview, so the page shows the banner', () => {
    expect(snap.preview).toBe(true);
  });
});

describe('RouterView', () => {
  it('shows the preview banner and all seven tabs', () => {
    renderView();
    const notes = screen.getAllByRole('note').map((n) => n.textContent ?? '');
    expect(notes.some((t) => t.startsWith('Preview.'))).toBe(true);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual([
      'Overview',
      'Models',
      'Providers & keys',
      'Tiers & privacy',
      'DelegationP2',
      'AbilitiesP3',
      'AnalyticsP4',
    ]);
  });

  it('renders every tab without crashing', () => {
    renderView();
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('tabpanel').textContent?.length).toBeGreaterThan(0);
    }
  });

  it('lists every private source under the always-on rule', () => {
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiers & privacy' }));
    for (const s of PRIVATE_SOURCES) expect(screen.getByText(s.label)).toBeTruthy();
  });

  it('opens the tier-3 question with its three answers', () => {
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiers & privacy' }));
    fireEvent.click(screen.getByRole('button', { name: /Preview the question/ }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toMatch(/Private work never goes to them/);
    for (const label of ['No, wait', 'Until Jarvis restarts', 'Just this once'])
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it('filters models by search and shows a model’s routes when opened', () => {
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
    fireEvent.change(screen.getByPlaceholderText('Search models or providers…'), {
      target: { value: 'gemini 2.5' },
    });
    const row = screen.getByRole('button', { name: /Gemini 2.5 Flash/ });
    expect(screen.queryByText('Llama 3.3 70B')).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('Pollinations')).toBeTruthy();
    expect(screen.getByText(/Same model, different doors/)).toBeTruthy();
  });
});
