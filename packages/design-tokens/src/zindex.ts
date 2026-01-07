/**
 * Z-Index tokens for Nullspace design system
 *
 * Provides consistent layering values for UI elements to prevent
 * z-index conflicts across web and mobile.
 *
 * NO platform-specific code - raw numeric values only
 *
 * Layer Hierarchy (low to high):
 * 1. Base content (0)
 * 2. Elevated cards, dropdowns (10)
 * 3. Sticky headers/footers (20)
 * 4. Overlays, backdrops (40)
 * 5. Modals, dialogs (50)
 * 6. Toasts, notifications (60)
 * 7. Dragging elements (100) - Always on top during drag
 */

/**
 * Z-index scale with semantic names
 * Values are spaced to allow insertion of intermediate layers if needed
 */
export const Z_INDEX = {
  /** Base layer - default stacking context (0) */
  base: 0,
  /** Elevated content - cards, dropdowns, popovers (10) */
  dropdown: 10,
  /** Sticky elements - headers, footers, toolbars (20) */
  sticky: 20,
  /** Overlay backdrops - dim overlays behind modals (40) */
  overlay: 40,
  /** Modal dialogs - confirmation dialogs, sheets (50) */
  modal: 50,
  /** Toasts and notifications - always visible (60) */
  toast: 60,
  /** Dragging elements - chip selector, drag handles (100) */
  dragging: 100,
} as const;

/**
 * Game-specific z-index values for complex game UIs
 * These extend the base scale for specialized game element layering
 */
export const Z_INDEX_GAME = {
  /** Table/board surface */
  table: 0,
  /** Cards on table */
  card: 5,
  /** Card being hovered/selected */
  cardHover: 10,
  /** Chips on table */
  chip: 15,
  /** Chip being dragged */
  chipDrag: 100,
  /** Bet panels */
  betPanel: 20,
  /** Game controls */
  controls: 30,
  /** Result overlays */
  result: 50,
} as const;

// Type exports for type inference
export type ZIndexKey = keyof typeof Z_INDEX;
export type ZIndexValue = (typeof Z_INDEX)[ZIndexKey];

export type ZIndexGameKey = keyof typeof Z_INDEX_GAME;
export type ZIndexGameValue = (typeof Z_INDEX_GAME)[ZIndexGameKey];
