import { describe, expect, it, vi } from 'vitest';
import type { SettingsService } from '../settings/settings-service';
import type { ToolContext } from '../tools/types';
import { createAppTools } from './app-tools';
import type { RefInfo } from './browser-dom';
import { createBrowserTrail, describeStep, findTarget, TRAIL_MAX_STEPS } from './browser-trail';

const REFS: RefInfo[] = [
  { ref: 'e1', role: 'searchbox', name: 'Search bills', tag: 'input', type: 'search' },
  { ref: 'e2', role: 'link', name: 'My account', tag: 'a', type: '' },
  { ref: 'e3', role: 'button', name: 'View', tag: 'button', type: 'submit' },
  { ref: 'e4', role: 'textbox', name: 'Password', tag: 'input', type: 'password', secret: true },
];

const ctx = (conversationId = 'c1') =>
  ({ conversationId, signal: new AbortController().signal }) as ToolContext;

function make() {
  const trail = createBrowserTrail();
  const browser = {
    open: vi.fn(() => ({ ok: true as const })),
    readPage: vi.fn(async () => null),
    navigate: vi.fn(() => true),
    close: vi.fn(),
    isOpen: () => true,
    state: () => null,
    snapshot: vi.fn(async () => ({
      url: 'https://power.example',
      title: 'P',
      lines: [],
      refs: REFS,
      truncated: false,
    })),
    refInfo: (ref: string) => REFS.find((r) => r.ref === ref),
    click: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    select: vi.fn(async () => 'x'),
    press: vi.fn(async () => undefined),
    scroll: vi.fn(async () => ({ y: 0, max: 0 })),
  };
  const tools = createAppTools({
    browser,
    show: vi.fn(),
    settings: {} as SettingsService,
    trail,
  });
  const tool = (n: string) => tools.find((t) => t.name === n)!;
  return { trail, browser, tool };
}

describe('browser recipes (ruflo browser-plugin idea)', () => {
  it('finds a control by role and name: exact first, then close', () => {
    expect(findTarget(REFS, { role: 'link', name: 'my account' })?.ref).toBe('e2');
    expect(findTarget(REFS, { name: 'Search' })?.ref).toBe('e1');
    expect(findTarget(REFS, { role: 'button', name: 'My account' })).toBeUndefined();
    expect(findTarget(REFS, { name: '  ' })).toBeUndefined();
  });

  it('records what worked, per conversation, by name instead of ref', async () => {
    const { trail, tool } = make();
    await tool('jarvis_browser').run({ action: 'open', url: 'https://power.example' }, ctx());
    await tool('browser_act').run({ action: 'click', ref: 'e2', direction: 'down' }, ctx());
    await tool('browser_type').run(
      { ref: 'e1', text: 'October', clear: true, submit: false },
      ctx(),
    );
    await tool('browser_act').run({ action: 'click', ref: 'e2', direction: 'down' }, ctx('c2'));
    expect(trail.get('c1').map(describeStep)).toEqual([
      'Open https://power.example',
      'Click the link "My account"',
      'Type "October" into the searchbox "Search bills"',
    ]);
    expect(trail.mostRecent()?.conversationId).toBe('c2');
  });

  it('keeps only the newest steps', () => {
    const trail = createBrowserTrail();
    for (let i = 0; i < TRAIL_MAX_STEPS + 5; i++)
      trail.record('c', { tool: 'browser_act', input: { action: 'press', key: `k${i}` } });
    expect(trail.get('c')).toHaveLength(TRAIL_MAX_STEPS);
  });

  it('a saved step finds its control on a fresh page and clicks it', async () => {
    const { tool, browser } = make();
    const out = await tool('browser_act').run(
      { action: 'click', target: { role: 'link', name: 'My account' }, direction: 'down' },
      ctx(),
    );
    expect(out.isError).toBeFalsy();
    expect(browser.click).toHaveBeenCalledWith('e2');
  });

  it('judges a saved click by its name, and refuses when the live control commits something', async () => {
    const { tool, browser } = make();
    const act = tool('browser_act');
    const tier = (i: unknown): unknown => (typeof act.tier === 'function' ? act.tier(i) : act.tier);
    expect(tier({ action: 'click', target: { name: 'Pay now' } })).toBe('CONFIRM');
    expect(tier({ action: 'click', target: { name: 'View' } })).toBe('SAFE');
    // "View" is a submit button on the live page: no silent submit.
    const out = await act.run(
      { action: 'click', target: { role: 'button', name: 'View' }, direction: 'down' },
      ctx(),
    );
    expect(out.isError).toBe(true);
    expect(browser.click).not.toHaveBeenCalled();
  });

  it('a saved typing step still refuses secret fields', async () => {
    const { tool, browser } = make();
    const out = await tool('browser_type').run(
      { target: { name: 'Password' }, text: 'x', clear: true, submit: false },
      ctx(),
    );
    expect(out.isError).toBe(true);
    expect(browser.type).not.toHaveBeenCalled();
  });
});
