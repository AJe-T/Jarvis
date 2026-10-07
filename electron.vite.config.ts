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
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          meter: resolve(__dirname, 'src/preload/meter.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        // meter.html: the hidden music meter (windows/music-meter.ts)
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          meter: resolve(__dirname, 'src/renderer/meter.html'),
        },
      },
    },
  },
});
