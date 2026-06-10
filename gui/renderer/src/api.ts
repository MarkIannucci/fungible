import type { RendererApi } from '../../shared/api-types.js';

export const api: RendererApi = new Proxy({} as RendererApi, {
  get: (_t, ns) =>
    new Proxy(
      {},
      {
        get:
          (_t2, fn) =>
          (...args: unknown[]) =>
            window.__bridge.call(String(ns), String(fn), args),
      },
    ),
});
