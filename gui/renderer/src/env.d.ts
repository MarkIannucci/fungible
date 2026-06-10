import type { Bridge } from '../../shared/api-types.js';

declare global {
  interface Window {
    __bridge: Bridge;
  }
}

export {};
