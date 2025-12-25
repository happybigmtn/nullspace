import React from 'react';

type PageHeaderProps = {
  title: string;
  status?: string | null;
  leading?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
};

export const PageHeader: React.FC<PageHeaderProps> = ({ title, status, leading, right, className }) => {
  return (
    <header
      className={[
        'border-b border-gray-800 bg-terminal-black/90 backdrop-blur px-4 py-3 flex flex-wrap items-center justify-between gap-3',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        {leading ? <div className="hidden sm:block">{leading}</div> : null}
        <div className="text-lg font-bold tracking-widest">{title}</div>
        {status ? <div className="text-[10px] text-gray-500 tracking-widest">{status}</div> : null}
      </div>
      {right ? <div className="flex items-center gap-3 flex-wrap">{right}</div> : null}
    </header>
  );
};
