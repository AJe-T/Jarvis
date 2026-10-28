import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Voice fix 1B found sherpa-onnx-node declared in package.json but missing from node_modules, so
 * installers were built without it and the default wake word ("spotter") could not load. Every
 * runtime dependency must be installed before tests (and therefore `npm run dist`) can pass.
 */
describe('installed dependencies', () => {
  it('every package.json dependency is present in node_modules (run `npm ci` if not)', () => {
    const root = join(__dirname, '..', '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const missing = Object.keys(pkg.dependencies).filter(
      (name) => !existsSync(join(root, 'node_modules', name, 'package.json')),
    );
    expect(missing).toEqual([]);
  });
});
