import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type SideBetsDrawerProps = {
  title?: string;
  label?: string;
  count?: number;
  shortcutHint?: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const SideBetsDrawer: React.FC<SideBetsDrawerProps> = ({
  title = 'SIDE BETS',
  label = 'Side Bets',
  count = 0,
  shortcutHint,
  disabled = false,
  className,
  children,
  open,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const hasActive = count > 0;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, setOpen]);

  const overlay = isOpen ? (
    <div className="fixed inset-0 z-[100]" data-testid="side-bets-drawer">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div
        className="absolute left-1/2 top-1/2 w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl liquid-card liquid-sheen shadow-float overflow-hidden"
        data-testid="side-bets-panel"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ns bg-ns-surface">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-ns-muted">{title}</span>
            {shortcutHint ? (
              <span className="text-[10px] font-mono text-ns-muted">[{shortcutHint}]</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ns-muted hover:text-ns"
          >
            Close
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`relative h-10 px-4 rounded-full border text-[11px] font-semibold uppercase tracking-[0.24em] transition-all liquid-chip ${
          disabled
            ? 'border-ns text-ns-muted cursor-not-allowed'
            : hasActive
              ? 'border-mono-0/50 text-mono-0 dark:text-mono-1000 bg-mono-0/10'
              : 'border-ns text-ns-muted hover:text-ns'
        } ${className ?? ''}`}
      >
        {label}
        {count > 0 ? (
          <span className="ml-2 rounded-full bg-mono-0/20 px-2 py-0.5 text-[10px] font-bold text-mono-0 dark:text-mono-1000">
            {count}
          </span>
        ) : null}
      </button>
      {overlay && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </>
  );
};
