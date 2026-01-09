/**
 * Utility functions for the website
 */

/**
 * Combines class names, filtering out falsy values
 * A lightweight alternative to clsx/classnames
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
