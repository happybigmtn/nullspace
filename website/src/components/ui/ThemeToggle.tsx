import React from 'react';
import { useTheme } from '../../hooks/useTheme';

type ThemeToggleProps = {
  className?: string;
  variant?: 'pill' | 'menu';
};

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className, variant = 'pill' }) => {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const isDark = theme === 'dark';

  const segmented = (
    <span className="inline-flex items-center gap-1 rounded-full liquid-chip p-0.5 text-[10px] font-bold uppercase tracking-[0.28em]">
      <span
        className={[
          'px-2 py-0.5 rounded-full transition-colors',
          isDark
            ? 'text-ns-muted'
            : 'bg-black/80 text-white shadow-soft dark:bg-white/80 dark:text-black',
        ].join(' ')}
      >
        Light
      </span>
      <span
        className={[
          'px-2 py-0.5 rounded-full transition-colors',
          isDark
            ? 'bg-black/80 text-white shadow-soft dark:bg-white/80 dark:text-black'
            : 'text-ns-muted',
        ].join(' ')}
      >
        Dark
      </span>
    </span>
  );

  if (variant === 'menu') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={['flex justify-between items-center gap-4 group', className ?? ''].join(' ').trim()}
        aria-label={`Switch to ${nextTheme} mode`}
        aria-pressed={isDark}
      >
        <span className="text-sm font-semibold text-ns">Theme</span>
        {segmented}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={isDark}
      className={[
        'inline-flex items-center gap-3 rounded-full liquid-chip px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.28em] transition-colors shadow-soft text-ns',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <span className="text-ns-muted">Theme</span>
      {segmented}
    </button>
  );
};
