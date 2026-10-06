import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, type ElectronApplication } from '@playwright/test';

/** Launches the built app (out/) in test mode with an isolated user-data dir. */
export async function launchApp(
  extraEnv: Record<string, string> = {},
  userDataDir = mkdtempSync(join(tmpdir(), 'jarvis-e2e-')),
): Promise<{ app: ElectronApplication; userDataDir: string }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env['ELECTRON_RUN_AS_NODE'];
  const app = await _electron.launch({
    args: ['.'],
    env: { ...env, JARVIS_TEST: '1', JARVIS_USER_DATA: userDataDir, ...extraEnv },
  });
  return { app, userDataDir };
}
