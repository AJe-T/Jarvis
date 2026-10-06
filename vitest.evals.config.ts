import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Testing.md §7: real-API evals, never part of `npm test` or CI.
const config = mergeConfig(
  base,
  defineConfig({
    test: { fileParallelism: false, testTimeout: 180_000, hookTimeout: 60_000 },
  }),
);
// mergeConfig concatenates arrays; evals replace the include list instead.
config.test = { ...config.test, include: ['tests/evals/**/*.eval.ts'] };
export default config;
