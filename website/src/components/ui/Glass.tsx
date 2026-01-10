/**
 * Liquid Glass Component Kit (US-266)
 *
 * A tight set of composable glass primitives built on the Liquid Crystal
 * material system (US-265). These replace ad-hoc per-screen styling with
 * consistent, reusable components.
 *
 * Depth Scale:
 * - flat: Flush with surface, minimal glass effect (whisper/mist)
 * - float: Elevated, prominent glass (smoke/veil)
 * - overlay: Maximum separation, modal-level glass (fog/frost)
 *
 * All components:
 * - Are strictly monochrome (no color accents)
 * - Support light/dark mode via Tailwind dark: classes
 * - Include @supports fallback for browsers without backdrop-filter
 * - Respect prefers-reduced-motion for animations
 */

import React from 'react';

/**
 * Depth levels for glass components
 * Maps semantic depth to Liquid Crystal material levels
 */
export type GlassDepth = 'flat' | 'float' | 'overlay';

/**
 * Common props shared by all glass components
 */
interface GlassBaseProps {
  /** Content to render inside the glass surface */
  children: React.ReactNode;
  /** Depth level controlling glass intensity */
  depth?: GlassDepth;
  /** Additional CSS classes */
  className?: string;
  /** Optional test ID for testing */
  'data-testid'?: string;
}

/**
 * Depth-to-class mappings for the glass effect
 * Uses Liquid Crystal tokens via Tailwind utilities
 */
const DEPTH_CLASSES: Record<GlassDepth, {
  bg: string;
  border: string;
  backdrop: string;
  shadow: string;
}> = {
  flat: {
    bg: 'bg-lc-mist dark:bg-lc-dark-mist',
    border: 'border border-lc-border-mist dark:border-lc-border-dark-mist',
    backdrop: 'backdrop-blur-lc-subtle backdrop-brightness-lc-subtle',
    shadow: '',
  },
  float: {
    bg: 'bg-lc-smoke dark:bg-lc-dark-smoke',
    border: 'border border-lc-border-smoke dark:border-lc-border-dark-smoke',
    backdrop: 'backdrop-blur-lc-standard backdrop-brightness-lc-standard',
    shadow: 'shadow-float shadow-lc-edge-standard',
  },
  overlay: {
    bg: 'bg-lc-fog dark:bg-lc-dark-fog',
    border: 'border border-lc-border-fog dark:border-lc-border-dark-fog',
    backdrop: 'backdrop-blur-lc-heavy backdrop-brightness-lc-heavy',
    shadow: 'shadow-modal shadow-lc-edge-pronounced',
  },
};

/**
 * Fallback classes for browsers without backdrop-filter support
 * Applied via @supports query in CSS
 */
const FALLBACK_BG: Record<GlassDepth, string> = {
  flat: 'supports-[not(backdrop-filter)]:bg-lc-fallback-mist supports-[not(backdrop-filter)]:dark:bg-lc-fallback-dark-mist',
  float: 'supports-[not(backdrop-filter)]:bg-lc-fallback-smoke supports-[not(backdrop-filter)]:dark:bg-lc-fallback-dark-smoke',
  overlay: 'supports-[not(backdrop-filter)]:bg-lc-fallback-fog supports-[not(backdrop-filter)]:dark:bg-lc-fallback-dark-fog',
};

/**
 * Helper to combine depth classes
 */
const getGlassClasses = (depth: GlassDepth): string => {
  const d = DEPTH_CLASSES[depth];
  const fallback = FALLBACK_BG[depth];
  return `${d.bg} ${d.border} ${d.backdrop} ${d.shadow} ${fallback}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// GlassCard - Content panels, sections, elevated surfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface GlassCardProps extends GlassBaseProps {
  /** Padding preset */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Border radius preset */
  radius?: 'none' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /** Interactive states (hover, active effects) */
  interactive?: boolean;
  /** Optional click handler (makes card a button) */
  onClick?: () => void;
}

const PADDING_CLASSES: Record<NonNullable<GlassCardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const RADIUS_CLASSES: Record<NonNullable<GlassCardProps['radius']>, string> = {
  none: 'rounded-none',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
};

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  depth = 'float',
  padding = 'md',
  radius = 'xl',
  interactive = false,
  onClick,
  className = '',
  'data-testid': testId,
}) => {
  const baseClasses = `${getGlassClasses(depth)} liquid-sheen ${PADDING_CLASSES[padding]} ${RADIUS_CLASSES[radius]}`;
  const interactiveClasses = interactive
    ? 'transition-all duration-200 hover:shadow-lg active:scale-[0.98] cursor-pointer motion-safe:motion-interaction'
    : '';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses} ${interactiveClasses} ${className}`}
        data-testid={testId}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      className={`${baseClasses} ${interactiveClasses} ${className}`}
      data-testid={testId}
    >
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GlassToolbar - Horizontal action bars, control strips
// ─────────────────────────────────────────────────────────────────────────────

export interface GlassToolbarProps extends GlassBaseProps {
  /** Toolbar position preset */
  position?: 'top' | 'bottom' | 'inline';
  /** Fixed positioning */
  fixed?: boolean;
  /** Justify content */
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
}

const JUSTIFY_CLASSES: Record<NonNullable<GlassToolbarProps['justify']>, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly',
};

export const GlassToolbar: React.FC<GlassToolbarProps> = ({
  children,
  depth = 'float',
  position = 'inline',
  fixed = false,
  justify = 'between',
  className = '',
  'data-testid': testId,
}) => {
  const baseClasses = `flex items-center gap-2 px-4 py-2 ${getGlassClasses(depth)} liquid-sheen rounded-full ${JUSTIFY_CLASSES[justify]}`;

  const getPositionClasses = () => {
    if (!fixed) return '';
    switch (position) {
      case 'top':
        return 'fixed top-4 left-1/2 -translate-x-1/2 z-50';
      case 'bottom':
        return 'fixed bottom-8 left-1/2 -translate-x-1/2 z-50';
      default:
        return '';
    }
  };
  const positionClasses = getPositionClasses();

  return (
    <div
      role="toolbar"
      className={`${baseClasses} ${positionClasses} ${className}`}
      data-testid={testId}
    >
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GlassChip - Compact buttons, badges, selectable pills
// ─────────────────────────────────────────────────────────────────────────────

export interface GlassChipProps extends GlassBaseProps {
  /** Chip size */
  size?: 'sm' | 'md' | 'lg';
  /** Selected/active state */
  selected?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Icon to display before label */
  icon?: React.ReactNode;
}

const CHIP_SIZE_CLASSES: Record<NonNullable<GlassChipProps['size']>, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1',
  md: 'h-9 px-3.5 text-sm gap-1.5',
  lg: 'h-11 px-4 text-base gap-2',
};

export const GlassChip: React.FC<GlassChipProps> = ({
  children,
  depth = 'flat',
  size = 'md',
  selected = false,
  disabled = false,
  onClick,
  icon,
  className = '',
  'data-testid': testId,
}) => {
  // Selected state uses solid depth, otherwise use provided depth
  const effectiveDepth = selected ? 'overlay' : depth;

  const baseClasses = `inline-flex items-center ${CHIP_SIZE_CLASSES[size]} rounded-full font-medium transition-all duration-150`;
  const glassClasses = `${getGlassClasses(effectiveDepth)} liquid-sheen`;

  const getStateClasses = () => {
    if (disabled) return 'opacity-40 cursor-not-allowed';
    if (onClick) return 'cursor-pointer hover:brightness-95 active:scale-95 motion-safe:motion-interaction';
    return '';
  };
  const stateClasses = getStateClasses();

  const selectedClasses = selected
    ? 'text-mono-1000 dark:text-mono-0 font-semibold'
    : 'text-mono-400 dark:text-mono-500';

  const Element = onClick ? 'button' : 'span';

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      className={`${baseClasses} ${glassClasses} ${stateClasses} ${selectedClasses} ${className}`}
      data-testid={testId}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </Element>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GlassModal - Dialogs, sheets, overlay panels
// ─────────────────────────────────────────────────────────────────────────────

export interface GlassModalProps extends GlassBaseProps {
  /** Whether the modal is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Modal variant */
  variant?: 'dialog' | 'sheet';
  /** Sheet position (only for sheet variant) */
  sheetPosition?: 'bottom' | 'right';
  /** Maximum width (only for dialog variant) */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Close on backdrop click */
  closeOnBackdrop?: boolean;
  /** Show close button */
  showClose?: boolean;
  /** Modal title (optional) */
  title?: string;
}

const MODAL_WIDTH_CLASSES: Record<NonNullable<GlassModalProps['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
};

export const GlassModal: React.FC<GlassModalProps> = ({
  children,
  open,
  onClose,
  variant = 'dialog',
  sheetPosition = 'bottom',
  maxWidth = 'md',
  closeOnBackdrop = true,
  showClose = true,
  title,
  className = '',
  'data-testid': testId,
}) => {
  // Always use overlay depth for modals
  const glassClasses = `${getGlassClasses('overlay')} liquid-sheen`;

  if (!open) return null;

  const handleBackdropClick = () => {
    if (closeOnBackdrop) {
      onClose();
    }
  };

  // Dialog variant - centered modal
  if (variant === 'dialog') {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        data-testid={testId}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-mono-0/20 dark:bg-mono-0/40 backdrop-blur-sm transition-opacity motion-safe:animate-scale-in"
          onClick={handleBackdropClick}
        />

        {/* Modal content */}
        <div
          className={`relative ${glassClasses} ${MODAL_WIDTH_CLASSES[maxWidth]} w-full rounded-2xl p-6 motion-safe:animate-scale-in ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {(title || showClose) && (
            <div className="flex items-center justify-between mb-4">
              {title && (
                <h2 className="text-lg font-semibold text-mono-0 dark:text-mono-1000">
                  {title}
                </h2>
              )}
              {showClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="ml-auto w-8 h-8 rounded-full bg-mono-100 dark:bg-mono-800 flex items-center justify-center text-mono-400 hover:text-mono-0 dark:hover:text-mono-1000 transition-colors"
                  aria-label="Close modal"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 1l12 12M13 1L1 13" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Content */}
          {children}
        </div>
      </div>
    );
  }

  const sheetClasses = sheetPosition === 'bottom'
    ? 'bottom-0 left-0 right-0 rounded-t-3xl max-h-[90vh]'
    : 'top-0 right-0 bottom-0 w-full max-w-md rounded-l-3xl';

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      data-testid={testId}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-mono-0/20 dark:bg-mono-0/40 backdrop-blur-sm transition-opacity"
        onClick={handleBackdropClick}
      />

      {/* Sheet content */}
      <div
        className={`absolute ${sheetClasses} ${glassClasses} p-6 overflow-y-auto motion-safe:animate-scale-in ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sheet handle (only for bottom sheets) */}
        {sheetPosition === 'bottom' && (
          <div className="w-12 h-1 bg-mono-200 dark:bg-mono-700 rounded-full mx-auto mb-4" />
        )}

        {/* Header */}
        {(title || showClose) && (
          <div className="flex items-center justify-between mb-4">
            {title && (
              <h2 className="text-lg font-semibold text-mono-0 dark:text-mono-1000">
                {title}
              </h2>
            )}
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                className="ml-auto w-10 h-10 rounded-full bg-mono-100 dark:bg-mono-800 flex items-center justify-center text-mono-400 hover:text-mono-0 dark:hover:text-mono-1000 transition-colors"
                aria-label="Close sheet"
              >
                <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {children}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GlassSurface - Generic glass container for custom layouts
// ─────────────────────────────────────────────────────────────────────────────

export interface GlassSurfaceProps extends GlassBaseProps {
  /** HTML element to render */
  as?: 'div' | 'section' | 'aside' | 'nav' | 'header' | 'footer';
  /** Click handler */
  onClick?: React.MouseEventHandler;
  /** Role attribute for accessibility */
  role?: string;
  /** Aria label */
  'aria-label'?: string;
}

export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  children,
  depth = 'float',
  as: Element = 'div',
  className = '',
  onClick,
  role,
  'aria-label': ariaLabel,
  'data-testid': testId,
}) => {
  const glassClasses = `${getGlassClasses(depth)} liquid-sheen`;

  return (
    <Element
      className={`${glassClasses} ${className}`}
      onClick={onClick}
      role={role}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </Element>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Export depth constants for external use
// ─────────────────────────────────────────────────────────────────────────────

export const GLASS_DEPTH = {
  /** Flush with surface, minimal glass effect */
  FLAT: 'flat' as const,
  /** Elevated, prominent glass */
  FLOAT: 'float' as const,
  /** Maximum separation, modal-level */
  OVERLAY: 'overlay' as const,
};
