import React from 'react';

interface LabelProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'success' | 'destructive' | 'gold';
  size?: 'micro' | 'normal';
}

export const Label: React.FC<LabelProps> = ({ 
  children, 
  className = '', 
  variant = 'primary',
  size = 'normal'
}) => {
  // US-261: Monochrome variants use contrast not color
  const variantClasses = {
    primary: 'text-titanium-600 dark:text-titanium-200',
    secondary: 'text-titanium-500 dark:text-titanium-300',
    success: 'text-mono-0 dark:text-mono-1000 font-bold',
    destructive: 'text-mono-400 dark:text-mono-500',
    gold: 'text-mono-0 dark:text-mono-1000 font-bold',
  };

  const sizeClasses = {
    micro: 'text-[8px] uppercase tracking-[0.24em]',
    normal: 'text-[10px] tracking-[0.04em]',
  };

  return (
    <span className={`${sizeClasses[size]} font-semibold ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
};
