import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Strict CSP for the packaged renderer. Build-only: the dev server needs
// inline scripts (react-refresh preamble) and a websocket for HMR.
// style-src 'unsafe-inline' is required for React style={} attributes.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const injectCsp = () => ({
  name: 'inject-csp',
  apply: 'build' as const,
  transformIndexHtml() {
    return [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend' as const,
      },
    ];
  },
});

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
    plugins: [react(), injectCsp()],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'gui/renderer/index.html'),
      },
    },
  },
});
