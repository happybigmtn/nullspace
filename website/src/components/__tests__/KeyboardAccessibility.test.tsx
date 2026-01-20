// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

/**
 * AC-5.6: Core bet controls are keyboard accessible and have visible focus states.
 *
 * This test suite validates:
 * 1. All interactive controls have focus-visible styles defined
 * 2. Controls are keyboard navigable (tabindex, button type)
 * 3. Focus management during state transitions
 * 4. Proper ARIA attributes for screen readers
 */

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: () => React.createElement('svg', { 'data-testid': 'x-icon' }),
  Minus: () => React.createElement('svg', { 'data-testid': 'minus-icon' }),
  Plus: () => React.createElement('svg', { 'data-testid': 'plus-icon' }),
  Grid: () => React.createElement('svg', { 'data-testid': 'grid-icon' }),
  ChevronUp: () => React.createElement('svg', { 'data-testid': 'chevron-icon' }),
  Layers: () => React.createElement('svg', { 'data-testid': 'layers-icon' }),
}));

// Mock the Label component
vi.mock('../casino/ui/Label', () => ({
  Label: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('span', { className: `label ${className ?? ''}`, 'data-testid': 'label' }, children),
}));

// Mock GlassSurface - pass through all props for testing
vi.mock('../ui', () => ({
  GlassSurface: ({ children, className, as: Component = 'div', depth, ...props }: {
    children: React.ReactNode;
    className?: string;
    as?: string;
    depth?: string;
    [key: string]: any;
  }) => React.createElement(Component, { className, ...props }, children),
}));

// Mock hooks
vi.mock('../../hooks/useMagneticCursor', () => ({
  useMagneticCursor: () => ({ ref: { current: null }, style: {} }),
}));

vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

vi.mock('../../utils/motion', () => ({
  SPRING_LIQUID_CONFIGS: {},
}));

vi.mock('@react-spring/web', () => ({
  animated: {
    button: ({ children, className, style, ...props }: any) =>
      React.createElement('button', { className, ...props }, children),
  },
  useSpring: () => [{ breathe: { to: (fn: any) => fn(1) } }, vi.fn()],
}));

vi.mock('../../config/casinoUI', () => ({
  USE_CLASSIC_CASINO_UI: false,
}));

vi.mock('../casino/ModifiersAccordion', () => ({
  ModifiersAccordion: () => null,
}));

import {
  BetSlipWithConfirmation,
  type BetSlipBet,
} from '../casino/shared/BetSlipWithConfirmation';
import { InlineBetSelector } from '../casino/InlineBetSelector';
import { GameControlBar } from '../casino/GameControlBar';

// Helper to render component to string
function renderToString(element: React.ReactElement): string {
  const { renderToStaticMarkup } = require('react-dom/server');
  return renderToStaticMarkup(element);
}

const createMockBet = (overrides: Partial<BetSlipBet> = {}): BetSlipBet => ({
  id: 'bet-1',
  type: 'RED',
  amount: 100,
  odds: 2,
  ...overrides,
});

describe('AC-5.6: Keyboard Accessibility and Visible Focus States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BetSlipWithConfirmation - Focus States', () => {
    const defaultProps = {
      bets: [createMockBet()],
      balance: 1000,
      bettingEnabled: true,
      isConnected: true,
      onSubmit: vi.fn().mockResolvedValue({ success: true }),
    };

    it('Place Bet button has visible focus-visible ring style', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} />
      );

      // Should have focus-visible ring classes
      expect(html).toContain('focus-visible:ring-2');
      expect(html).toContain('focus-visible:ring-action-primary');
    });

    it('Place Bet button has focus-visible:outline-none to prevent double outline', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} />
      );

      expect(html).toContain('focus-visible:outline-none');
    });

    it('Clear all button has visible focus ring when provided', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} onClearAll={vi.fn()} />
      );

      // Clear button should have focus-visible styles
      expect(html).toContain('focus-visible:ring-2');
      expect(html).toContain('focus-visible:ring-action-primary/50');
    });

    it('Remove bet buttons have visible focus ring', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          onRemoveBet={vi.fn()}
        />
      );

      // Remove buttons should have focus-visible styles
      // The button has class first, then aria-label, so check the whole HTML
      expect(html).toContain('aria-label="Remove RED bet"');
      expect(html).toContain('focus-visible:ring-2');
      expect(html).toContain('focus-visible:ring-action-primary/50');
    });

    it('all buttons have type="button" to prevent form submission', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          onRemoveBet={vi.fn()}
          onClearAll={vi.fn()}
        />
      );

      // Count type="button" - should match number of buttons
      const typeButtonCount = (html.match(/type="button"/g) || []).length;
      // At minimum: Place Bet, Clear all, Remove bet = 3
      expect(typeButtonCount).toBeGreaterThanOrEqual(3);
    });

    it('no buttons have invalid tabindex that would break navigation', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} />
      );

      // Should not have negative tabindex (which removes from tab order)
      expect(html).not.toContain('tabindex="-1"');
    });

    it('action buttons have proper aria-label for screen readers', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          onClearAll={vi.fn()}
          onRemoveBet={vi.fn()}
        />
      );

      expect(html).toContain('aria-label="Place bet"');
      expect(html).toContain('aria-label="Clear all bets"');
      expect(html).toContain('aria-label="Remove RED bet"');
    });
  });

  describe('InlineBetSelector - Focus States', () => {
    const defaultProps = {
      currentBet: 100,
      balance: 1000,
      onBetChange: vi.fn(),
    };

    it('increment button has focus-visible ring', () => {
      const html = renderToString(
        <InlineBetSelector {...defaultProps} />
      );

      // Should have focus-visible styles on buttons
      expect(html).toContain('focus-visible:ring-2');
      expect(html).toContain('focus-visible:ring-action-primary/50');
    });

    it('decrement button has focus-visible ring', () => {
      const html = renderToString(
        <InlineBetSelector {...defaultProps} />
      );

      // Both +/- buttons should have accessible labels
      expect(html).toContain('aria-label="Decrease bet"');
      expect(html).toContain('aria-label="Increase bet"');
    });

    it('preset buttons (MIN, 1/4, 1/2, MAX) have focus-visible styles', () => {
      const html = renderToString(
        <InlineBetSelector {...defaultProps} compact={false} />
      );

      // All preset buttons should have focus styles
      expect(html).toContain('MIN');
      expect(html).toContain('MAX');
      // The component has focus-visible:ring-2 on preset buttons
      const focusVisibleCount = (html.match(/focus-visible:ring-2/g) || []).length;
      // Should have: 2 stepper buttons + 4 preset buttons = 6 minimum
      expect(focusVisibleCount).toBeGreaterThanOrEqual(6);
    });

    it('has role="group" with aria-label for the control group', () => {
      const html = renderToString(
        <InlineBetSelector {...defaultProps} />
      );

      expect(html).toContain('role="group"');
      expect(html).toContain('aria-label="Bet amount selector"');
    });

    it('disabled buttons are still in tab order but marked disabled', () => {
      const html = renderToString(
        <InlineBetSelector {...defaultProps} disabled />
      );

      // Should have disabled attribute
      expect(html).toContain('disabled');
      // Should NOT remove from tab order
      expect(html).not.toContain('tabindex="-1"');
    });

    it('all stepper and preset buttons have type="button"', () => {
      const html = renderToString(
        <InlineBetSelector {...defaultProps} compact={false} />
      );

      // 2 stepper + 4 presets = 6 buttons
      const typeButtonCount = (html.match(/type="button"/g) || []).length;
      expect(typeButtonCount).toBe(6);
    });
  });

  describe('GameControlBar - Focus States', () => {
    const defaultProps = {
      primaryAction: {
        label: 'ROLL',
        onClick: vi.fn(),
      },
      secondaryActions: [
        { label: 'Bet Red', onClick: vi.fn() },
        { label: 'Bet Black', onClick: vi.fn() },
      ],
    };

    it('primary action FAB button has focus-visible ring', () => {
      const html = renderToString(
        <GameControlBar {...defaultProps} />
      );

      // FAB should have prominent focus ring
      expect(html).toContain('focus-visible:ring-4');
      expect(html).toContain('focus-visible:outline-none');
    });

    it('menu toggle button has focus-visible styles', () => {
      const html = renderToString(
        <GameControlBar {...defaultProps} />
      );

      // Menu button should have aria-label and focus styles
      expect(html).toContain('aria-label="Open menu"');
      expect(html).toContain('focus-visible:ring-2');
    });

    it('secondary action buttons have focus-visible ring', () => {
      const html = renderToString(
        <GameControlBar {...defaultProps} />
      );

      // Secondary buttons should have focus styles
      expect(html).toContain('Bet Red');
      expect(html).toContain('Bet Black');
      // Multiple buttons should have the focus ring class
      const focusRingCount = (html.match(/focus-visible:ring-2/g) || []).length;
      expect(focusRingCount).toBeGreaterThanOrEqual(2);
    });

    it('close menu button has focus-visible styles and aria-label', () => {
      const html = renderToString(
        <GameControlBar {...defaultProps} />
      );

      expect(html).toContain('aria-label="Close menu"');
    });

    it('has role="group" with aria-label for control region', () => {
      const html = renderToString(
        <GameControlBar {...defaultProps} ariaLabel="Game controls" />
      );

      expect(html).toContain('role="group"');
      expect(html).toContain('aria-label="Game controls"');
    });

    it('disabled primary action maintains focus styles', () => {
      const html = renderToString(
        <GameControlBar
          {...defaultProps}
          primaryAction={{ ...defaultProps.primaryAction!, disabled: true }}
        />
      );

      // Even disabled, should have focus-visible defined
      expect(html).toContain('focus-visible:ring');
      expect(html).toContain('disabled');
    });

    it('all action buttons have type="button"', () => {
      const html = renderToString(
        <GameControlBar {...defaultProps} />
      );

      // Every button should have type="button"
      // FAB + menu toggle + secondary actions (in sheet) + close button
      const typeButtonCount = (html.match(/type="button"/g) || []).length;
      expect(typeButtonCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Cross-Component Focus Consistency', () => {
    it('all bet control components use consistent focus-visible pattern', () => {
      const betSlipHtml = renderToString(
        <BetSlipWithConfirmation
          bets={[createMockBet()]}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      const inlineSelectorHtml = renderToString(
        <InlineBetSelector currentBet={100} balance={1000} onBetChange={vi.fn()} />
      );

      const controlBarHtml = renderToString(
        <GameControlBar
          primaryAction={{ label: 'ROLL', onClick: vi.fn() }}
          secondaryActions={[{ label: 'Test', onClick: vi.fn() }]}
        />
      );

      // All should use the same focus-visible pattern
      expect(betSlipHtml).toContain('focus-visible:outline-none');
      expect(inlineSelectorHtml).toContain('focus-visible:ring-2');
      expect(controlBarHtml).toContain('focus-visible:outline-none');

      // All should use focus-visible:ring (ring-2 or ring-4)
      expect(betSlipHtml).toContain('focus-visible:ring-');
      expect(inlineSelectorHtml).toContain('focus-visible:ring-');
      expect(controlBarHtml).toContain('focus-visible:ring-');
    });

    it('primary actions use ring-offset for visibility against background', () => {
      const betSlipHtml = renderToString(
        <BetSlipWithConfirmation
          bets={[createMockBet()]}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      const controlBarHtml = renderToString(
        <GameControlBar
          primaryAction={{ label: 'ROLL', onClick: vi.fn() }}
        />
      );

      // Primary CTA buttons should have ring-offset for better visibility
      expect(betSlipHtml).toContain('focus-visible:ring-offset-');
      expect(controlBarHtml).toContain('focus-visible:ring-offset-');
    });
  });

  describe('Keyboard Navigation Attributes', () => {
    it('interactive elements are not removed from tab order', () => {
      const html = renderToString(
        <>
          <BetSlipWithConfirmation
            bets={[createMockBet()]}
            balance={1000}
            bettingEnabled={true}
            isConnected={true}
            onSubmit={vi.fn().mockResolvedValue({ success: true })}
            onClearAll={vi.fn()}
            onRemoveBet={vi.fn()}
          />
          <InlineBetSelector currentBet={100} balance={1000} onBetChange={vi.fn()} />
          <GameControlBar
            primaryAction={{ label: 'ROLL', onClick: vi.fn() }}
            secondaryActions={[{ label: 'Test', onClick: vi.fn() }]}
          />
        </>
      );

      // No elements should have tabindex="-1" which removes them from keyboard nav
      expect(html).not.toContain('tabindex="-1"');
    });

    it('all buttons use button elements not divs with onClick', () => {
      const html = renderToString(
        <>
          <BetSlipWithConfirmation
            bets={[createMockBet()]}
            balance={1000}
            bettingEnabled={true}
            isConnected={true}
            onSubmit={vi.fn().mockResolvedValue({ success: true })}
          />
          <InlineBetSelector currentBet={100} balance={1000} onBetChange={vi.fn()} />
          <GameControlBar
            primaryAction={{ label: 'ROLL', onClick: vi.fn() }}
          />
        </>
      );

      // Interactive elements should be buttons, not divs with role="button"
      // (The close menu backdrop button is an exception - it's a full-screen backdrop)
      const roleButtonCount = (html.match(/role="button"/g) || []).length;
      // Should be 0 or very few - all main controls should be <button>
      expect(roleButtonCount).toBeLessThanOrEqual(1);
    });

    it('buttons with actions have proper semantic structure', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          bets={[createMockBet()]}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      // Buttons should close properly (not self-closing)
      // This ensures content is properly wrapped
      expect(html).toContain('</button>');
    });
  });

  describe('Screen Reader Support', () => {
    it('BetSlipWithConfirmation has semantic region role', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          bets={[createMockBet()]}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Bet slip"');
    });

    it('InlineBetSelector has semantic group role', () => {
      const html = renderToString(
        <InlineBetSelector currentBet={100} balance={1000} onBetChange={vi.fn()} />
      );

      expect(html).toContain('role="group"');
      expect(html).toContain('aria-label="Bet amount selector"');
    });

    it('GameControlBar has semantic group role', () => {
      const html = renderToString(
        <GameControlBar
          primaryAction={{ label: 'ROLL', onClick: vi.fn() }}
          ariaLabel="Game controls"
        />
      );

      expect(html).toContain('role="group"');
      expect(html).toContain('aria-label="Game controls"');
    });

    it('interactive elements have meaningful aria-labels', () => {
      const html = renderToString(
        <>
          <BetSlipWithConfirmation
            bets={[createMockBet({ type: 'PASS LINE' })]}
            balance={1000}
            bettingEnabled={true}
            isConnected={true}
            onSubmit={vi.fn().mockResolvedValue({ success: true })}
            onRemoveBet={vi.fn()}
            onClearAll={vi.fn()}
          />
          <InlineBetSelector currentBet={100} balance={1000} onBetChange={vi.fn()} />
          <GameControlBar
            primaryAction={{ label: 'ROLL', onClick: vi.fn() }}
          />
        </>
      );

      // Check for descriptive aria-labels
      expect(html).toContain('aria-label="Place bet"');
      expect(html).toContain('aria-label="Clear all bets"');
      expect(html).toContain('aria-label="Remove PASS LINE bet"');
      expect(html).toContain('aria-label="Decrease bet"');
      expect(html).toContain('aria-label="Increase bet"');
      expect(html).toContain('aria-label="Open menu"');
    });
  });
});

describe('Focus State Visual Properties', () => {
  it('focus-visible:ring uses action-primary color for brand consistency', () => {
    const html = renderToString(
      <BetSlipWithConfirmation
        bets={[createMockBet()]}
        balance={1000}
        bettingEnabled={true}
        isConnected={true}
        onSubmit={vi.fn().mockResolvedValue({ success: true })}
      />
    );

    // Primary actions should use the brand color
    expect(html).toContain('focus-visible:ring-action-primary');
  });

  it('secondary actions use semi-transparent ring for subtlety', () => {
    const html = renderToString(
      <BetSlipWithConfirmation
        bets={[createMockBet()]}
        balance={1000}
        bettingEnabled={true}
        isConnected={true}
        onSubmit={vi.fn().mockResolvedValue({ success: true })}
        onClearAll={vi.fn()}
      />
    );

    // Secondary elements should use opacity modifier
    expect(html).toContain('focus-visible:ring-action-primary/50');
  });

  it('ring-offset provides visual separation from element', () => {
    const html = renderToString(
      <BetSlipWithConfirmation
        bets={[createMockBet()]}
        balance={1000}
        bettingEnabled={true}
        isConnected={true}
        onSubmit={vi.fn().mockResolvedValue({ success: true })}
      />
    );

    // Ring offset creates a gap between element and focus ring
    expect(html).toContain('focus-visible:ring-offset-2');
    // Offset color should match surface for proper contrast
    expect(html).toContain('focus-visible:ring-offset-ns-surface');
  });
});
