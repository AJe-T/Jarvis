import { z } from 'zod';
import { createDesktopOperator } from '../../agent/desktop-operator';
import { pickModel } from '../../agent/model-router';
import { errorMessage } from '../../errors';
import { logger } from '../../logging/logger';
import type { Services } from '../../services';
import { defineTool, fail, ok } from '../types';
import type { InputDriver, ScreenSource } from './drivers';
import { dipToShot, shotGeometry, shotToPhysical } from './geometry';
import { createMemberExecutor } from './member-executor';

export interface ComputerDeps {
  screen: ScreenSource;
  driver: () => Promise<InputDriver>;
  overlay: { show(): void; hide(): void };
  /** Minimise Jarvis so it does not cover the app being operated; restore afterwards. */
  mainWindow: { minimize(): void; restore(): void };
}

/** Phase 6: Computer-Control mode (Architecture.md §9). */
export function createComputerSystem(s: Services, deps: ComputerDeps) {
  let driver: InputDriver | null = null;
  const getDriver = async (): Promise<InputDriver> => (driver ??= await deps.driver());
  let active = false;

  const lazyInput: InputDriver = {
    move: async (x, y) => (await getDriver()).move(x, y),
    position: async () => (await getDriver()).position(),
    click: async (b, n) => (await getDriver()).click(b, n),
    down: async (b) => (await getDriver()).down(b),
    up: async (b) => (await getDriver()).up(b),
    scroll: async (dir, n) => (await getDriver()).scroll(dir, n),
    type: async (t) => (await getDriver()).type(t),
    keysDown: async (k) => (await getDriver()).keysDown(k),
    keysUp: async (k) => (await getDriver()).keysUp(k),
    releaseAll: async () => driver?.releaseAll(),
  };

  const members = createMemberExecutor({
    input: lazyInput,
    screen: deps.screen,
    confirm: async (summary, reason) => {
      const r = await s.broker.request(
        {
          toolName: 'computer',
          title: `Allow "${summary}"?`,
          humanSummary: summary,
          details: reason,
          detailsKind: 'text',
          actionLabel: 'Allow',
          destructive: true,
        },
        s.killSwitch.signal(),
      );
      return r.decision === 'approve';
    },
  });

  const operator = createDesktopOperator({
    llm: () => s.llm,
    model: () => pickModel(s.settings, { purpose: 'desktop_agent' }),
    maxActions: () => s.settings.get('agent.computerMaxActions'),
    budget: s.budget,
    ledger: s.ledger,
    members,
    toolCalls: s.toolCalls,
    audit: s.audit,
    emit: (e, p) => s.emit(e, p),
    logger,
    session: {
      start: async () => {
        active = true;
        deps.mainWindow.minimize();
        deps.overlay.show();
        s.emit('computer:active', { active: true });
      },
      end: async () => {
        active = false;
        await lazyInput.releaseAll().catch(() => undefined);
        deps.overlay.hide();
        deps.mainWindow.restore();
        s.emit('computer:active', { active: false });
      },
    },
  });

  s.registry.register(
    defineTool({
      name: 'delegate_desktop_task',
      description:
        "Let the Desktop Operator control the mouse and keyboard to do ONE GUI task that no other tool can (clicking inside an app's interface). Slower and costlier than native tools. Describe the goal precisely; it returns a short report.",
      input: z.object({
        goal: z.string().min(5).max(500),
        constraints: z.string().max(500).optional(),
      }),
      tier: 'CONFIRM',
      timeoutMs: 20 * 60_000,
      summarize: ({ goal }) => `Control the PC to: ${goal}`,
      confirm: ({ goal, constraints }) => ({
        title: 'Let Jarvis control your PC?',
        actionLabel: 'Start computer control',
        details: `${goal}${constraints ? `\n\nConstraints: ${constraints}` : ''}\n\nA red border shows while Jarvis is in control. Press Ctrl+Alt+Shift+X or click Stop to end it at any time.`,
        detailsKind: 'text',
      }),
      async run({ goal, constraints }, ctx) {
        const r = await operator.run(goal, constraints ?? '', {
          conversationId: ctx.conversationId,
          turnId: ctx.turnId,
          signal: ctx.signal,
        });
        return r.ok ? ok(r.report) : fail(r.report);
      },
    }),
  );

  // Security.md §11: the kill switch releases held keys/buttons and hides the overlay.
  s.killSwitch.onKill(() => {
    void lazyInput.releaseAll().catch(() => undefined);
    if (active) {
      deps.overlay.hide();
      s.emit('computer:active', { active: false });
    }
  });

  /** Testing.md §10 manual QA: move to known points and compare where Windows says the cursor is. */
  async function calibrate(): Promise<{ ok: boolean; maxErrorPx: number }> {
    const d = deps.screen.display();
    const g = shotGeometry(d);
    const input = await getDriver();
    const before = await input.position();
    let maxErrorPx = 0;
    try {
      for (const [fx, fy] of [
        [0.25, 0.25],
        [0.5, 0.5],
        [0.75, 0.6],
      ] as const) {
        const target: [number, number] = [
          Math.round(g.shot.width * fx),
          Math.round(g.shot.height * fy),
        ];
        const p = shotToPhysical(g, d, target);
        await input.move(p.x, p.y);
        await new Promise((r) => setTimeout(r, 60));
        const [sx, sy] = dipToShot(g, d, deps.screen.cursorDip());
        maxErrorPx = Math.max(maxErrorPx, Math.abs(sx - target[0]), Math.abs(sy - target[1]));
      }
    } catch (err) {
      logger.warn({ err: errorMessage(err) }, 'calibration failed');
      return { ok: false, maxErrorPx: -1 };
    } finally {
      await input.move(before.x, before.y).catch(() => undefined);
    }
    return { ok: maxErrorPx <= 3, maxErrorPx };
  }

  return { operator, members, calibrate, isActive: () => active };
}
