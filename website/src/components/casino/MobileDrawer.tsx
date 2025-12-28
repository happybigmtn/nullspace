import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type MobileDrawerProps = {
  label: string;
  title: string;
  children: React.ReactNode;
  className?: string;
};

export const MobileDrawer: React.FC<MobileDrawerProps> = ({ label, title, children, className }) => {
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
    <div className="fixed inset-0 z-[100] md:hidden" data-testid="mobile-drawer">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92%] max-w-sm sm:max-w-md max-h-[80vh] sm:max-h-[85vh] bg-titanium-900 border-2 border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        data-testid="mobile-drawer-panel"
        data-drawer-label={label}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-titanium-900/90">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">{title}</div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[10px] px-2 py-1 rounded border border-gray-700 bg-black/40 text-gray-400 hover:border-gray-500"
          >
            ESC
          </button>
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
        className={`md:hidden text-[10px] tracking-widest uppercase font-mono px-2 py-1 rounded border border-gray-700 bg-black/40 text-gray-300 hover:border-gray-500 hover:text-white ${className ?? ''}`}
      >
        {label}
      </button>
      {overlay && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </>
  );
};
