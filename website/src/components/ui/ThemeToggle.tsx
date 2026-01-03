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
    <span className="inline-flex items-center gap-1 rounded-full bg-titanium-200 p-0.5 text-[10px] font-bold uppercase tracking-widest dark:bg-titanium-800">
      <span
        className={[
          'px-2 py-0.5 rounded-full transition-colors',
          isDark
            ? 'text-titanium-600 dark:text-titanium-400'
            : 'bg-titanium-900 text-white shadow-soft dark:bg-white dark:text-titanium-900',
        ].join(' ')}
      >
        Light
      </span>
      <span
        className={[
          'px-2 py-0.5 rounded-full transition-colors',
          isDark
            ? 'bg-titanium-900 text-white shadow-soft dark:bg-white dark:text-titanium-900'
            : 'text-titanium-600 dark:text-titanium-400',
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
        <span className="text-sm font-semibold text-titanium-800 dark:text-titanium-100">Theme</span>
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
        'inline-flex items-center gap-3 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors shadow-soft',
        'border-titanium-300 bg-white text-titanium-900 hover:border-titanium-500',
        'dark:border-titanium-700 dark:bg-titanium-900/70 dark:text-titanium-100 dark:hover:border-titanium-500',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <span className="text-titanium-600 dark:text-titanium-300">Theme</span>
      {segmented}
    </button>
  );
};
