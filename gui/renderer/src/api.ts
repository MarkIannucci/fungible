import type { RendererApi } from '../../shared/api-types.js';

export const api: RendererApi = new Proxy({} as RendererApi, {
  get: (_t, ns) => {
    // Symbols and thenable/serialization probes (await, JSON.stringify,
    // DevTools) must not turn into stray bridge calls.
    if (typeof ns !== 'string' || ns === 'then' || ns === 'toJSON') return undefined;
    return new Proxy(
      {},
      {
        get: (_t2, fn) => {
          if (typeof fn !== 'string' || fn === 'then' || fn === 'toJSON') return undefined;
          return (...args: unknown[]) => window.__bridge.call(ns, fn, args);
        },
      },
    );
  },
});
