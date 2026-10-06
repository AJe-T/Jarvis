import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventChannel } from '@shared/ipc-channels';
import { createFakeClaude, type FakeScript } from '@main/llm/fake-claude';
import type { LlmClient } from '@main/llm/types';
import type { Encryptor } from '@main/settings/secrets';
import { createServices } from '@main/services';
import { createFakeOs } from '@main/tools/native/os';

/** Reversible stand-in for DPAPI so tests can run anywhere. */
export const fakeEncryptor: Encryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
};

/** `realLlm` swaps the FakeClaude for a real client (evals only). */
export function setupServices(
  script: FakeScript | ((dir: string) => FakeScript) = { rules: [] },
  realLlm?: LlmClient,
) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-int-'));
  const home = (n: string): string => {
    const p = join(dir, 'home', n);
    mkdirSync(p, { recursive: true });
    return p;
  };
  const events: Array<{ event: EventChannel; payload: unknown }> = [];
  const llm = createFakeClaude(typeof script === 'function' ? script(dir) : script);
  const services = createServices({
    userData: join(dir, 'data'),
    isTest: true,
    encryptor: fakeEncryptor,
    emit: (event, payload) => events.push({ event, payload }),
    llm: realLlm ?? llm,
    os: createFakeOs(),
    home: join(dir, 'home'),
    paths: {
      documents: home('Documents'),
      desktop: home('Desktop'),
      downloads: home('Downloads'),
      pictures: home('Pictures'),
      videos: home('Videos'),
      music: home('Music'),
    },
  });
  return { dir, services, events, llm };
}

/** Resolves when the orchestrator has no running or queued turns. */
export async function idle(
  services: ReturnType<typeof setupServices>['services'],
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (services.orchestrator.isBusy()) {
    if (Date.now() - start > timeoutMs) throw new Error('orchestrator did not go idle');
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 20));
}
