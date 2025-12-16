import React, { useEffect, useState } from 'react';

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`md:hidden text-[10px] tracking-widest px-2 py-1 rounded border border-gray-700 bg-black/40 text-gray-300 hover:border-gray-500 ${className ?? ''}`}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-sm max-h-[80vh] bg-terminal-black border-2 border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-terminal-black/90">
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
      )}
    </>
  );
};

