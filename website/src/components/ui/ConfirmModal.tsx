import React, { useEffect } from 'react';

type ConfirmModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  onClose,
  onConfirm,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />
      <div className="relative w-full max-w-md border border-gray-800 rounded-lg bg-titanium-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-titanium-900/90">
          <div className="text-[10px] text-gray-500 tracking-widest uppercase">{title}</div>
          <button
            type="button"
            onClick={loading ? undefined : onClose}
            className="text-[10px] px-2 py-1 rounded border border-gray-700 bg-black/40 text-gray-400 hover:border-gray-500"
          >
            ESC
          </button>
        </div>

        <div className="p-4">{children}</div>

        <div className="px-4 py-3 border-t border-gray-800 bg-titanium-900/90 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={loading ? undefined : onClose}
            className="h-11 px-4 rounded border border-gray-700 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-500"
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={loading ? undefined : onConfirm}
            className="h-11 px-4 rounded border border-action-destructive text-action-destructive text-[10px] tracking-widest uppercase hover:bg-action-destructive/10 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? 'Confirming…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

