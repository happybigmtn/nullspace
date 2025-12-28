import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { dismissToast, getToasts, subscribeToasts, type Toast } from '../../services/toasts';

function levelClasses(level: Toast['level']) {
  switch (level) {
    case 'success':
      return 'border-action-success text-action-success';
    case 'error':
      return 'border-action-destructive text-action-destructive';
    default:
      return 'border-gray-700 text-gray-400';
  }
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>(() => getToasts());

  useEffect(() => {
    return subscribeToasts(() => {
      setToasts(getToasts());
    });
  }, []);

  const timers = useMemo(() => {
    const now = Date.now();
    return toasts.map((t) => ({
      id: t.id,
      ms: Math.max(0, t.expiresAt - now),
    }));
  }, [toasts]);

  useEffect(() => {
    const handles = timers.map((t) => setTimeout(() => dismissToast(t.id), t.ms));
    return () => {
      for (const h of handles) clearTimeout(h);
    };
  }, [timers]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[1000] space-y-2 pointer-events-none">
      {toasts.map((t) => {
        const isInternal = !!t.href && t.href.startsWith('/');
        const messageNode = t.href ? (
          isInternal ? (
            <Link to={t.href} className="text-[11px] text-gray-200 hover:underline">
              {t.message}
            </Link>
          ) : (
            <a href={t.href} className="text-[11px] text-gray-200 hover:underline" target="_blank" rel="noreferrer">
              {t.message}
            </a>
          )
        ) : (
          <div className="text-[11px] text-gray-200">{t.message}</div>
        );

        return (
          <div
            key={t.id}
            className={[
              'pointer-events-auto w-[min(92vw,420px)] rounded border bg-titanium-900/95 backdrop-blur px-3 py-2 shadow-lg',
              levelClasses(t.level),
            ].join(' ')}
            role="status"
          >
            <div className="flex items-start gap-3">
              <div className="text-[10px] tracking-widest uppercase whitespace-nowrap">{t.level}</div>
              <div className="min-w-0 flex-1">{messageNode}</div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="text-gray-500 hover:text-white text-[12px] leading-none px-1"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

