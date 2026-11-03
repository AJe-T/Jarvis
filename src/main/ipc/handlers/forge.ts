import { execFile } from 'node:child_process';
import { claudeCodeStatus } from '../../llm/claude-code';
import { nodeRunsRea } from '../../claude-sessions/rea';
import type { ForgeDesk } from '../../forge/desk';
import { FIRST_RUN_REQUEST, readiness } from '../../forge/readiness';
import { nodeRunsTools } from '../../forge/tool-runtime';
import { systemNode } from '../../lib/process';
import type { Services } from '../../services';
import { handle } from '../handle';

/** `git --version`, no shell; null when git isn't installed. */
function gitVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['--version'], { timeout: 10_000, windowsHide: true }, (err, stdout) =>
      resolve(err ? null : stdout.trim().slice(0, 80)),
    );
  });
}

/**
 * Sidebar → Forge: the chat (F9), Forge's memory, notebooks and chats, read-only (F10), and the
 * first-run checklist (F12).
 */
export function registerForgeHandlers(desk: ForgeDesk, s: Services): void {
  handle('forge:messages', () => desk.chat.messages(200));
  // Returns once Sir's message is saved; the desk's reply comes as a forge:message event.
  handle('forge:send', (req) => desk.chat.send(req.text, 'text'));
  handle('forge:files', (req) => desk.store.list(req.dir));
  handle('forge:file', async (req) => ({
    path: req.path,
    markdown: await desk.store.read(req.path),
  }));
  // F12: read-only checks of everything a real run needs, each with a plain fix.
  handle('forge:readiness', () =>
    readiness({
      repoUrl: () => s.settings.get('forge.repoUrl'),
      node: systemNode,
      nodeRunsTools,
      nodeRunsRea,
      gitVersion,
      claude: () => claudeCodeStatus(s.claudeCode.path()),
      vaultReady: () => desk.store.ready(),
      freeWorkers: () => ({
        enabled: s.settings.get('pool.enabled') && s.settings.get('forge.freeWorkers'),
        poolReady: s.pool.ready(),
      }),
      budgetUsd: () => s.settings.get('forge.budgetUsd'),
    }),
  );
  // F12: Sir pressed "Start my first run": the suggested request goes to the desk as his message
  // (fixed text from the code, not from a model); the desk still agrees the goal and asks first.
  handle('forge:firstRun', () => desk.chat.send(FIRST_RUN_REQUEST, 'text'));
}
