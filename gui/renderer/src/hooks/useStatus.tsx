import React, { useCallback, useRef, useState } from 'react';
import styles from './useStatus.module.css';

/** Toast-style status message, analog of the TUI's useStatusMessage. */
export function useStatus() {
  const [statusMsg, setStatusMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showStatus = useCallback((msg: string, duration = 2000) => {
    setStatusMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatusMsg(''), duration);
  }, []);

  const statusEl = statusMsg ? <div className={styles.toast}>{statusMsg}</div> : null;
  return { showStatus, statusEl };
}
