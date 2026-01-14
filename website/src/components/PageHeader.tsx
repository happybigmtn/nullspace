import React from 'react';
import { ThemeToggle } from './ui/ThemeToggle';
import { GlassSurface } from './ui';

type PageHeaderProps = {
  title: string;
  status?: React.ReactNode;
  leading?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
};

export const PageHeader: React.FC<PageHeaderProps> = ({ title, status, leading, right, className }) => {
  const statusNode =
    status === null || status === undefined ? null : typeof status === 'string' ? (
      <div className="liquid-chip px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-ns-muted">
        {status}
      </div>
    ) : (
      status
    );
  return (
    <GlassSurface
      as="header"
      depth="flat"
      className={[
        'liquid-card p-5',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h1 className="text-xl sm:text-2xl font-display tracking-tight text-ns">{title}</h1>
            {statusNode}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {right ? right : null}
            <ThemeToggle />
          </div>
        </div>
        {leading ? (
          <div className="flex items-center gap-3">
            {leading}
          </div>
        ) : null}
      </div>
    </GlassSurface>
  );
};
