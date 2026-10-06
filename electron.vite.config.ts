import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const alias = {
  '@main': resolve(__dirname, 'src/main'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      // node:sqlite is only importable with the node: prefix, so it is not in builtinModules.
      rollupOptions: { external: ['node:sqlite'] },
    },
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: true },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
  },
});
