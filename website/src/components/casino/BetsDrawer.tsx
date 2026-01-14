import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type BetsDrawerProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
};

export const BetsDrawer: React.FC<BetsDrawerProps> = ({ title = 'PLACE BETS', children, className }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const overlay = open ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bets drawer"
      className="fixed inset-0 z-[100] md:hidden"
      data-testid="bets-drawer"
    >
      <button
        type="button"
        aria-label="Close bets drawer"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
        onClick={() => setOpen(false)}
      />
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-sm sm:max-w-md max-h-[80vh] sm:max-h-[85vh] liquid-card liquid-sheen overflow-hidden flex flex-col"
        data-testid="bets-drawer-panel"
        data-drawer-label="Bets"
      >
        <div className="flex flex-col items-center gap-1 px-3 py-2 border-b border-ns-border/60">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Bets"
            className="liquid-chip flex items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-ns focus-visible:ring-2 focus-visible:ring-action-primary/50"
          >
            <span>Bets</span>
            <span aria-hidden>▾</span>
          </button>
          {title ? (
            <div className="text-[10px] text-ns-muted uppercase tracking-widest">{title}</div>
          ) : null}
        </div>
        <div className="p-3 overflow-y-auto">{children}</div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Bets"
        className={`md:hidden liquid-chip text-[11px] px-3 py-2 flex items-center gap-1 text-ns ${className ?? ''}`}
      >
        <span>Bets</span>
        <span aria-hidden>▾</span>
      </button>
      {overlay && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </>
  );
};
