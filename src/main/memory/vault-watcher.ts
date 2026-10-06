import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { errorMessage } from '../errors';
import type { Logger } from '../logging/logger';
import type { Indexer } from './indexer';
import { normalizeRel } from './vault-service';

const IGNORED = /[\\/](\.obsidian|\.trash|_jarvis|\.git)([\\/]|$)|\.tmp$/;

/** Database.md §8.6: Sir's edits in Obsidian are re-indexed within seconds; our own writes are skipped by hash. */
export function createVaultWatcher(deps: {
  root(): string;
  indexer: Indexer;
  logger: Logger;
  onChange(paths: string[]): void;
  onRoutinesChanged(): Promise<void>;
}) {
  let watcher: FSWatcher | null = null;
  const log = deps.logger.child({ module: 'memory.watcher' });

  function rel(abs: string): string {
    return normalizeRel(path.relative(deps.root(), abs));
  }

  async function onUpsert(abs: string): Promise<void> {
    if (!abs.toLowerCase().endsWith('.md')) return;
    const r = rel(abs);
    try {
      if (await deps.indexer.indexFile(r, 'external')) deps.onChange([r]);
    } catch (err) {
      log.warn({ path: r, err: errorMessage(err) }, 're-index failed');
    }
  }

  return {
    async start(): Promise<void> {
      await this.stop();
      watcher = watch(deps.root(), {
        ignoreInitial: true,
        ignored: (p: string) => IGNORED.test(p),
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      });
      watcher.on('add', (p) => void onUpsert(p));
      watcher.on('change', (p) => void onUpsert(p));
      watcher.on('unlink', (p) => {
        const r = rel(p);
        deps.indexer.remove(r);
        deps.onChange([r]);
        if (r.startsWith('Routines/')) void deps.onRoutinesChanged();
      });
      watcher.on('error', (err) => log.warn({ err: errorMessage(err) }, 'watcher error'));
      await new Promise<void>((resolve) => watcher?.once('ready', () => resolve()));
    },
    async stop(): Promise<void> {
      await watcher?.close();
      watcher = null;
    },
  };
}

export type VaultWatcher = ReturnType<typeof createVaultWatcher>;
