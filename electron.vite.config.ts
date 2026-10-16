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
      rollupOptions: {
        external: ['node:sqlite'],
        // inference-host: the utility process that runs Whisper, Kokoro and Laya (ADR-029).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'inference-host': resolve(__dirname, 'src/main/inference/host.ts'),
        },
      },
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
          'browser-bar': resolve(__dirname, 'src/preload/browser-bar.ts'),
          terminal: resolve(__dirname, 'src/preload/terminal.ts'),
          capture: resolve(__dirname, 'src/preload/capture.ts'),
          camera: resolve(__dirname, 'src/preload/camera.ts'),
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
          'browser-bar': resolve(__dirname, 'src/renderer/browser-bar.html'),
          terminal: resolve(__dirname, 'src/renderer/terminal.html'),
          // camera.html: Jarvis Camera beside the orb (apps/camera-view.ts), the only page that may open the camera on its own.
          camera: resolve(__dirname, 'src/renderer/camera.html'),
          // capture.html: the hidden window that opens the microphone and camera (windows/capture-window.ts).
          capture: resolve(__dirname, 'src/renderer/capture.html'),
          // artifact.html: the sandboxed frame chat artifacts render in (components/jarvis/artifact.tsx).
          artifact: resolve(__dirname, 'src/renderer/artifact.html'),
        },
      },
    },
  },
});
