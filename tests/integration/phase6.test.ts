import { describe, expect, it } from 'vitest';
import type { FakeScript } from '@main/llm/fake-claude';
import type { ToolResultBlockParam } from '@main/llm/types';
import { createComputerSystem } from '@main/tools/computer/computer-system';
import { createFakeDriver, createFakeScreen } from '@main/tools/computer/drivers';
import { idle, setupServices } from './helpers';

const OP = 'You are the Desktop Operator';
const shot = { name: 'screenshot', input: {}, toolset: 'computer' };

function setupComputer(
  operatorSteps: FakeScript['rules'][number]['steps'],
  opts: { maxActions?: number } = {},
) {
  const t = setupServices({
    rules: [
      { system: OP, steps: operatorSteps },
      {
        match: 'notepad',
        steps: [
          {
            tools: [
              {
                name: 'delegate_desktop_task',
                input: { goal: 'In Notepad, type a shopping list' },
              },
            ],
          },
          { text: 'Done, sir.' },
        ],
      },
    ],
  });
  if (opts.maxActions) t.services.settings.set('agent.computerMaxActions', opts.maxActions);
  const driver = createFakeDriver();
  const overlay = {
    shown: 0,
    hidden: 0,
    show() {
      this.shown++;
    },
    hide() {
      this.hidden++;
    },
  };
  const main = {
    minimized: 0,
    restored: 0,
    minimize() {
      this.minimized++;
    },
    restore() {
      this.restored++;
    },
  };
  const computer = createComputerSystem(t.services, {
    screen: createFakeScreen(),
    driver: async () => driver,
    overlay,
    mainWindow: main,
  });
  t.services.confirmShowListeners.add((e) =>
    t.services.broker.respond(e.requestId, 'approve', 'click'),
  );
  return { ...t, driver, overlay, main, computer };
}

const delegateResult = (t: ReturnType<typeof setupComputer>): ToolResultBlockParam => {
  const chat = t.llm.calls.filter(
    (c) => c.system && JSON.stringify(c.system).includes('You are JARVIS'),
  );
  return (
    chat.at(-1)?.messages.at(-1)?.content as ToolResultBlockParam[]
  )[0] as ToolResultBlockParam;
};

describe('phase 6 computer control (Testing.md §10 with fakes)', () => {
  it('delegate → confirm → operator loop → report; overlay shown and hidden', async () => {
    const t = setupComputer([
      { text: 'I see the desktop.', tools: [shot] },
      {
        tools: [
          { name: 'left_click', input: { coordinate: [100, 100] }, toolset: 'computer' },
          { name: 'type', input: { text: 'Milk\nEggs' }, toolset: 'computer' },
          shot,
        ],
      },
      { text: 'RESULT: success\nTyped the list in Notepad.' },
    ]);
    t.services.orchestrator.send({ text: 'in notepad type a shopping list', source: 'text' });
    await idle(t.services, 10_000);
    expect(JSON.stringify(delegateResult(t).content)).toContain('RESULT: success');
    expect(t.driver.log).toEqual(expect.arrayContaining(['click left x1', 'type Milk\nEggs']));
    expect(t.overlay.shown).toBe(1);
    expect(t.overlay.hidden).toBe(1);
    expect(t.main.minimized).toBe(1);
    expect(
      t.events
        .filter((e) => e.event === 'computer:active')
        .map((e) => (e.payload as { active: boolean }).active),
    ).toEqual([true, false]);
    const rows = t.services.toolCalls.list(20).filter((r) => r.toolset_name === 'computer');
    expect(rows.map((r) => r.tool_name).sort()).toEqual([
      'left_click',
      'screenshot',
      'screenshot',
      'type',
    ]);
    const opCalls = t.llm.calls.filter((c) => JSON.stringify(c.system).includes(OP));
    expect(JSON.stringify(opCalls[0]?.tools)).toContain('computer_toolset_20260801');
    // Every computer tool_result echoes toolset_name.
    const lastOp = opCalls.at(-1)?.messages.at(-1)?.content as ToolResultBlockParam[];
    expect(lastOp.every((r) => r.toolset_name === 'computer')).toBe(true);
  });

  it('halts the rest of a batch after a failed member', async () => {
    const t = setupComputer([
      {
        tools: [
          { name: 'type', input: { text: 'card 4111 1111 1111 1111' }, toolset: 'computer' },
          shot,
        ],
      },
      { text: 'RESULT: failed\nThat looked like card data.' },
    ]);
    t.services.orchestrator.send({ text: 'notepad please', source: 'text' });
    await idle(t.services, 10_000);
    const opCalls = t.llm.calls.filter((c) => JSON.stringify(c.system).includes(OP));
    const results = opCalls[1]?.messages.at(-1)?.content as ToolResultBlockParam[];
    expect(results[0]?.is_error).toBe(true);
    expect(results[1]?.content).toBe(
      'Not executed: an earlier computer action in this turn failed.',
    );
    expect(t.driver.log.some((l) => l.startsWith('type'))).toBe(false);
    expect(t.services.audit.all().some((a) => a.event === 'desktop.blocked')).toBe(true);
  });

  it('stops at the action limit', async () => {
    const t = setupComputer([{ tools: [shot, shot, shot] }], { maxActions: 2 });
    t.services.orchestrator.send({ text: 'notepad loop', source: 'text' });
    await idle(t.services, 10_000);
    expect(JSON.stringify(delegateResult(t).content)).toMatch(/stopped after 2 actions/);
  });

  it('kill switch during a held key releases it and hides the overlay (Testing.md §6.6)', async () => {
    const t = setupComputer([
      {
        tools: [{ name: 'hold_key', input: { text: 'shift', duration: 20 }, toolset: 'computer' }],
      },
      { text: 'RESULT: success' },
    ]);
    t.services.orchestrator.send({ text: 'notepad hold', source: 'text' });
    const start = Date.now();
    while (!t.driver.held.has('LeftShift') && Date.now() - start < 5000)
      await new Promise((r) => setTimeout(r, 20));
    expect(t.driver.held.has('LeftShift')).toBe(true);
    t.services.killSwitch.trigger('hotkey');
    await idle(t.services, 10_000);
    expect(t.driver.held.size).toBe(0);
    expect(t.overlay.hidden).toBeGreaterThanOrEqual(1);
    expect(t.services.state.get()).toBe('IDLE');
  });

  it('calibration reports its accuracy', async () => {
    const t = setupComputer([]);
    const r = await t.computer.calibrate();
    // The fake screen always reports the cursor at (0,0), so calibration must notice the mismatch.
    expect(r.ok).toBe(false);
    expect(r.maxErrorPx).toBeGreaterThan(3);
  });
});
