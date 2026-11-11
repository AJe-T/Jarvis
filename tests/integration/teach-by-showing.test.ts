import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WatchEvent } from '@main/automation/watch-me';
import type { FakeScript } from '@main/llm/fake-claude';
import { createMemorySystem } from '@main/memory/memory-system';
import { idle, setupServices } from './helpers';

/** Services with a fake window watcher, memory started, and every confirmation approved and noted. */
async function setup(script: FakeScript) {
  const watcher = { emit: (_e: WatchEvent): void => undefined, stopped: 0 };
  const t = setupServices(script, {
    startWatcher: (_seconds, onEvent) => {
      watcher.emit = onEvent;
      return { stop: () => void watcher.stopped++ };
    },
  });
  t.services.settings.set('onboarding.complete', true);
  const m = createMemorySystem(t.services);
  await m.start();
  const asked: Array<{ title: string; details: string }> = [];
  t.services.confirmShowListeners.add((e) => {
    asked.push({ title: e.title, details: e.details });
    setTimeout(() => t.services.broker.respond(e.requestId, 'approve', 'click'), 5);
  });
  const say = async (text: string, conversationId?: string): Promise<string> => {
    const sent = t.services.orchestrator.send({
      text,
      source: 'text',
      ...(conversationId ? { conversationId } : {}),
    });
    await idle(t.services);
    return sent.conversationId;
  };
  return { ...t, m, watcher, asked, say, vaultRoot: t.services.settings.get('vault.path') };
}

const see = (process: string, title: string, control = '', kind = 'Pane'): WatchEvent => ({
  process,
  title,
  pid: 7,
  hwnd: 1,
  control,
  kind,
  secret: false,
});

describe('teach by showing (2.73)', () => {
  it('watch me → Sir does it → done → the steps Jarvis proposes are shown and saved as a routine', async () => {
    const t = await setup({
      rules: [
        {
          match: 'watch me',
          steps: [{ tools: [{ name: 'watch_me', input: {} }] }, { text: 'Go ahead, sir.' }],
        },
        {
          match: 'done',
          steps: [
            { tools: [{ name: 'stop_watching', input: {} }] },
            {
              tools: [
                {
                  name: 'save_routine',
                  input: {
                    name: 'Morning setup',
                    triggers: ['morning setup'],
                    steps: [
                      { tool: 'open_app', input: { name: 'Notepad' } },
                      { tool: 'set_volume', input: { level: 30 } },
                    ],
                  },
                },
              ],
            },
            { text: 'Saved as "Morning setup", sir.' },
          ],
        },
      ],
    });
    const conv = await t.say('watch me set up my morning');
    expect(t.asked[0]?.title).toBe('Let Jarvis watch what you do?');
    t.watcher.emit(see('notepad', 'Untitled - Notepad', 'Text editor', 'Edit'));
    t.watcher.emit(see('SndVol', 'Volume Mixer', 'Volume', 'Slider'));
    await t.say('done', conv);

    expect(t.watcher.stopped).toBe(1);
    // What Jarvis saw reached the model as tool output, marked untrusted.
    const sent = JSON.stringify(t.llm.calls.at(-1)?.messages);
    expect(sent).toContain('notepad — Untitled - Notepad');
    expect(sent).toContain('Slider \\"Volume\\"');
    // Sir saw every step before it was saved.
    const save = t.asked.find((a) => a.title.includes('Morning setup'));
    expect(save?.details).toBe('1. open_app {"name":"Notepad"}\n2. set_volume {"level":30}');
    const note = readFileSync(join(t.vaultRoot, 'Routines', 'Morning setup.md'), 'utf8');
    expect(note).toContain('kind: routine');
    await t.m.reloadRoutines();
    const r = t.m.repos.routines.byName('Morning setup');
    expect(r?.error ?? null).toBeNull();
    expect(r?.enabled).toBe(1);
    await t.m.watcher.stop();
  });

  it('refuses steps that are not real tools or may not run unattended, and saves nothing', async () => {
    const t = await setup({
      rules: [
        {
          match: 'bad shell',
          steps: [
            {
              tools: [
                {
                  name: 'save_routine',
                  input: {
                    name: 'Shell thing',
                    steps: [
                      { tool: 'run_powershell', input: { script: 'Get-Date', purpose: 'x' } },
                    ],
                  },
                },
              ],
            },
            { text: 'That cannot be a routine, sir.' },
          ],
        },
        {
          match: 'bad tool',
          steps: [
            {
              tools: [
                {
                  name: 'save_routine',
                  input: { name: 'Ghost', steps: [{ tool: 'no_such_tool', input: {} }] },
                },
              ],
            },
            { text: 'That tool does not exist, sir.' },
          ],
        },
      ],
    });
    await t.say('bad shell');
    await t.say('bad tool');
    expect(existsSync(join(t.vaultRoot, 'Routines', 'Shell thing.md'))).toBe(false);
    expect(existsSync(join(t.vaultRoot, 'Routines', 'Ghost.md'))).toBe(false);
    const results = t.services.toolCalls
      .list(10)
      .filter((c) => c.tool_name === 'save_routine')
      .map((c) => c.status);
    expect(results).toHaveLength(2);
    expect(results).toEqual(['error', 'error']);
    await t.m.watcher.stop();
  });
});
