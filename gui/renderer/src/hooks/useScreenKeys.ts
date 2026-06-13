import { useEffect, useRef } from 'react';
import { useUiPrefs } from './useUiPrefs.js';

export type KeyHandlers = Record<string, (e: KeyboardEvent) => void>;

/** TUI-style keybindings, active only when the user enables the keys toggle.
 *  Keys are KeyboardEvent.key values ('r', 'Tab', 'ArrowLeft', '/', …).
 *  Skipped while typing in a field or while a modal is open. */
export function useScreenKeys(handlers: KeyHandlers) {
  const { keys } = useUiPrefs();
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (document.querySelector('[data-modal]')) return;
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);
}
