import React, { useEffect } from 'react';
import styles from './Modal.module.css';

export function Modal({
  title,
  onClose,
  children,
  accent,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  accent?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} data-modal onMouseDown={onClose}>
      <div
        className={styles.panel}
        style={accent ? { borderColor: accent } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button className={styles.close} onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
