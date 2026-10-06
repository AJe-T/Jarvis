import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.ts',
    ],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    env: { JARVIS_TEST: '1' },
    coverage: {
      provider: 'v8',
      include: ['src/main/**', 'src/shared/**', 'src/renderer/src/**'],
      exclude: ['**/*.test.*', '**/*.md', 'src/main/index.ts'],
    },
  },
});
