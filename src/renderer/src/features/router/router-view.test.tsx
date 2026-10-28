// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import { PRIVATE_SOURCES } from '@shared/free-pool';
import { previewSnapshot } from './preview';
import { RouterView } from './router-view';

const snapshot = vi.fn(async () => ({ ...previewSnapshot(0), preview: false }));
const settings = vi.fn(async (patch: Record<string, unknown>) => ({
  ...previewSnapshot(0),
  preview: false,
  ...patch,
}));
const setModel = vi.fn(async () => ({ ...previewSnapshot(0), preview: false }));
const setProvider = vi.fn(async () => ({ ...previewSnapshot(0), preview: false }));

const EMPTY: Record<string, unknown> = {
  'secrets:status': {},
  'pool:analytics': {
    range: '7d',
    buckets: [],
    totals: {
      requests: 0,
      successRate: 0,
      tokensIn: 0,
      tokensOut: 0,
      avgMs: 0,
      p95Ms: 0,
      savedUsd: 0,
    },
    providers: [],
    models: [],
  },
};

const mocks = (): Record<string, unknown> => ({
  'pool:snapshot': snapshot,
  'pool:settings': settings,
  'pool:setModel': setModel,
  'pool:setProvider': setProvider,
});

beforeEach(() => {
  snapshot.mockClear();
  settings.mockClear();
  setModel.mockClear();
  (window as unknown as { jarvis: unknown }).jarvis = {
    // Every other channel (the map's keys, the Main brain tab's settings) answers empty.
    call: new Proxy(mocks(), {
      get: (o, k: string): unknown => o[k] ?? (async () => EMPTY[k] ?? []),
    }),
    on: () => () => undefined,
    send: {},
  };
});
afterEach(cleanup);

async function renderView(): Promise<void> {
  render(
    <Tooltip.Provider>
      <RouterView />
    </Tooltip.Provider>,
  );
  await screen.findByText('Free answers today');
}

describe('sample snapshot', () => {
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
});

describe('RouterView', () => {
  it('loads the live snapshot: everyday tabs first, then the set-once ones; opens on Usage', async () => {
    await renderView();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Numbers are samples/)).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Usage',
      'API keys',
      'Free models',
      'Abilities',
      'Main brain',
      'Rules',
      'AI tree',
      'History',
    ]);
    expect(screen.getByRole('tab', { name: 'Usage' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Usage: totals left for today, week and month; per provider, with where each number comes from', async () => {
    await renderView();
    const tokens = screen.getByRole('region', { name: 'Free tokens' });
    // Groq 400K + Cerebras 1M a day; 200K used.
    expect(tokens.textContent).toMatch(/1.2Ms*left of 1.4M/);
    // OpenRouter and NVIDIA publish no token cap: named, not counted as zero.
    expect(tokens.textContent).toMatch(/not in the total.*OpenRouter, NVIDIA NIM/);
    fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
    expect(tokens.textContent).toMatch(/left of 43.4M/);
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getAllByText('no daily cap').length).toBeGreaterThan(0);
    // Sir types his console's numbers; they go to main as his own.
    fireEvent.click(screen.getByRole('button', { name: "Set Groq's free allowance" }));
    fireEvent.change(screen.getByLabelText('Free tokens a day'), { target: { value: '500,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setProvider).toHaveBeenCalledWith({ id: 'groq', tpd: 500_000, rpd: null });
  });

  it('AI tree: drawn top down from Jarvis', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'AI tree' }));
    expect(screen.getByRole('img', { name: /Jarvis's AI tree/ })).toBeTruthy();
  });

  it('renders every tab without crashing', async () => {
    await renderView();
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('tabpanel').textContent?.length).toBeGreaterThan(0);
    }
  });

  it('lists every private source under the always-on rule and saves the tier-3 choice', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    for (const s of PRIVATE_SOURCES) expect(screen.getByText(s.label)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Third-party AIs'), { target: { value: 'never' } });
    expect(settings).toHaveBeenCalledWith({ tier3: 'never' });
  });

  it('wires every delegation rule to its setting (front door off by default)', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    const door = screen.getByRole('switch', { name: 'Front door' });
    expect(door.getAttribute('aria-checked')).toBe('false');
    expect(door.hasAttribute('disabled')).toBe(false);
    fireEvent.click(door);
    expect(settings).toHaveBeenCalledWith({ delegation: { frontDoor: true } });
    fireEvent.click(screen.getByRole('switch', { name: 'Hand-over note' }));
    expect(settings).toHaveBeenCalledWith({ delegation: { handover: false } });
  });

  it('wires every ability to its setting; cloud hearing waits for Sir to confirm', async () => {
    const image = vi.fn(async () => ({
      path: 'Images/2026-10-28-owl.jpg',
      by: 'Cloudflare Workers AI · FLUX.1 [schnell]',
      dataUrl: 'data:image/jpeg;base64,AA==',
    }));
    (window as unknown as { jarvis: { call: Record<string, unknown> } }).jarvis.call['pool:image'] =
      image;
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Abilities' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Free web search' }));
    expect(settings).toHaveBeenCalledWith({ abilities: { search: false } });
    fireEvent.click(screen.getByRole('switch', { name: 'Fusion brain' }));
    expect(settings).toHaveBeenCalledWith({ abilities: { fusion: false } });
    fireEvent.click(screen.getByRole('switch', { name: 'Speaking backup' }));
    expect(settings).toHaveBeenCalledWith({ abilities: { voiceSpeaking: false } });
    const hearing = screen.getByRole('switch', { name: 'Cloud hearing backup' });
    expect(hearing.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(hearing);
    // Sir's recorded voice: nothing changes until he confirms in the dialog.
    expect(settings).not.toHaveBeenCalledWith({ abilities: { voiceHearing: true } });

    fireEvent.change(screen.getByLabelText('Describe the image'), {
      target: { value: 'a neon owl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByText(/Made by Cloudflare Workers AI/)).toBeTruthy();
    expect(image).toHaveBeenCalledWith({ prompt: 'a neon owl', size: 'square' });
  });

  it('opens the tier-3 question with its three answers', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    fireEvent.click(screen.getByRole('button', { name: /Preview the question/ }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Private work never goes to them/);
    for (const label of ['No, wait', 'Until Jarvis restarts', 'Just this once'])
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it('filters models, shows a model’s routes, and sends strategy and on/off to main', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Free models' }));
    fireEvent.change(screen.getByPlaceholderText('Search models or providers…'), {
      target: { value: 'gemini 2.5' },
    });
    expect(screen.queryByText('Llama 3.3 70B')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Gemini 2.5 Flash/ }));
    expect(screen.getByText(/Same model, different doors/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Priority' }));
    expect(settings).toHaveBeenCalledWith({ strategy: 'priority' });
    fireEvent.click(screen.getByRole('switch', { name: 'Use Gemini 2.5 Flash' }));
    expect(setModel).toHaveBeenCalledWith({ model: 'gemini-2.5-flash', enabled: false });
  });

  it('Phase 4: every strategy, learning, shrinking and chains reach main', async () => {
    const chains = vi.fn(async () => ({ ...previewSnapshot(0), preview: false }));
    (window as unknown as { jarvis: { call: Record<string, unknown> } }).jarvis.call[
      'pool:setChains'
    ] = chains;
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Free models' }));
    for (const [label, id] of [
      ['Smartest', 'smartest'],
      ['Fastest', 'fastest'],
      ['Most reliable', 'reliable'],
      ['Custom', 'custom'],
    ] as const) {
      fireEvent.click(screen.getByRole('radio', { name: label }));
      expect(settings).toHaveBeenCalledWith({ strategy: id });
    }
    fireEvent.click(screen.getByRole('switch', { name: 'Learn from real answers' }));
    expect(settings).toHaveBeenCalledWith({ learn: false });
    fireEvent.click(screen.getByRole('switch', { name: 'Shrink long prompts' }));
    expect(settings).toHaveBeenCalledWith({ shrink: false });
    fireEvent.change(screen.getByLabelText('New chain name'), { target: { value: 'Coding' } });
    fireEvent.click(screen.getByRole('button', { name: /New chain/ }));
    expect(chains).toHaveBeenCalledWith({ chains: [{ name: 'Coding', models: [] }] });
  });

  it('the Main brain and API keys tabs are the only home of these settings', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'Main brain' }));
    expect(screen.getByRole('button', { name: /Learn more: Main brain/ })).toBeTruthy();
    expect(screen.getByText("Claude's models")).toBeTruthy();
    expect(screen.getByText('Budget')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'API keys' }));
    expect(screen.getByRole('button', { name: /Learn more: API keys/ })).toBeTruthy();
    expect(screen.getByText('API keys and their models')).toBeTruthy();
    expect(screen.getByText('Free search keys')).toBeTruthy();
  });
});
