import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type PanelDrawerProps = {
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

export const PanelDrawer: React.FC<PanelDrawerProps> = ({
  title = 'DETAILS',
  label = 'Details',
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
    <div className="fixed inset-0 z-[110]" data-testid="panel-drawer">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div
        className="absolute left-1/2 top-1/2 w-[92%] max-w-xl -translate-x-1/2 -translate-y-1/2 liquid-card overflow-hidden"
        data-testid="panel-drawer-panel"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/50">
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
        <div className="max-h-[72vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`relative h-10 px-4 rounded-full liquid-chip text-[11px] font-semibold uppercase tracking-[0.24em] transition-all ${
          disabled
            ? 'opacity-60 cursor-not-allowed'
            : hasActive
              ? 'text-ns border-black/20'
              : 'text-ns-muted hover:text-ns'
        } ${className ?? ''}`}
      >
        {label}
        {count > 0 ? (
          <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-bold text-ns">
            {count}
          </span>
        ) : null}
      </button>
      {overlay && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </>
  );
};
