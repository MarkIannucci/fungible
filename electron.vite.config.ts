import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(import.meta.dirname, 'gui/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(import.meta.dirname, 'gui/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'gui/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'gui/renderer/index.html'),
      },
    },
  },
});
