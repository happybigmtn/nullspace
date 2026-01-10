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
    primary: 'text-ns-muted',
    secondary: 'text-ns-muted',
    success: 'text-ns font-bold',
    destructive: 'text-ns-muted',
    gold: 'text-ns font-bold',
  };

  const sizeClasses = {
    micro: 'text-[8px] uppercase tracking-[0.24em]',
    normal: 'text-[10px] tracking-[0.2em] uppercase',
  };

  return (
    <span className={`${sizeClasses[size]} font-semibold ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
};
