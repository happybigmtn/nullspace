import React, { useState } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { GameErrorBoundary } from '../GameErrorBoundary';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

const Broken = () => {
  throw new Error('boom');
};

describe('GameErrorBoundary', () => {
  beforeEach(() => {
    mockGoBack.mockReset();
  });

  it('renders children when no error', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GameErrorBoundary>
          <Text>OK</Text>
        </GameErrorBoundary>
      );
    });

    const text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    expect(text).toContain('OK');
  });

  it('shows fallback UI when child throws', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GameErrorBoundary>
          <Broken />
        </GameErrorBoundary>
      );
    });

    const text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    expect(text).toContain('Something went wrong');
    const buttons = tree.root.findAll((node) => typeof node.props.onPress === 'function');
    const backButton = buttons.find((node) =>
      node.findAllByType(Text).some((textNode) => textNode.props.children === 'Back to Lobby')
    );
    act(() => {
      backButton?.props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // ========================================================================
  // Retry Mechanism Tests (US-056)
  // ========================================================================

  describe('Retry mechanism', () => {
    // Helper to find the retry button
    const findRetryButton = (tree: ReactTestRenderer) => {
      const buttons = tree.root.findAll((node) => typeof node.props.onPress === 'function');
      return buttons.find((node) =>
        node.findAllByType(Text).some((textNode) => textNode.props.children === 'Try Again')
      );
    };

    it('re-renders children after retry button click', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Use boolean flag controlled outside render cycle
      let shouldSucceed = false;

      const ConditionalError = () => {
        if (!shouldSucceed) {
          throw new Error('component error');
        }
        return <Text>Recovered!</Text>;
      };

      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <GameErrorBoundary>
            <ConditionalError />
          </GameErrorBoundary>
        );
      });

      // Should show error UI
      let texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Something went wrong');

      // Click retry - set flag BEFORE clicking
      shouldSucceed = true;
      const retryButton = findRetryButton(tree);
      expect(retryButton).toBeDefined();

      act(() => {
        retryButton?.props.onPress();
      });

      // Should now show recovered content
      texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Recovered!');
      expect(texts).not.toContain('Something went wrong');

      errorSpy.mockRestore();
    });

    it('handles persistent error on retry (retry -> error again)', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Component that always throws
      const AlwaysThrows = () => {
        throw new Error('persistent failure');
      };

      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <GameErrorBoundary>
            <AlwaysThrows />
          </GameErrorBoundary>
        );
      });

      // Should show error UI
      let texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Something went wrong');

      // Click retry
      const retryButton = findRetryButton(tree);
      act(() => {
        retryButton?.props.onPress();
      });

      // Should still show error UI (child throws again)
      texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Something went wrong');

      // Try button should still be available for another retry
      expect(findRetryButton(tree)).toBeDefined();

      errorSpy.mockRestore();
    });

    it('handles multiple rapid retries without issues', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Track retry button clicks, not render attempts
      let retryClickCount = 0;
      const CLICKS_NEEDED = 3;

      const ThrowsUntilClicks = () => {
        if (retryClickCount < CLICKS_NEEDED) {
          throw new Error(`error before ${CLICKS_NEEDED} clicks`);
        }
        return <Text>Finally works!</Text>;
      };

      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <GameErrorBoundary>
            <ThrowsUntilClicks />
          </GameErrorBoundary>
        );
      });

      // Should show error UI initially
      let texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Something went wrong');

      // Multiple retries
      for (let i = 0; i < CLICKS_NEEDED; i++) {
        retryClickCount++;
        act(() => {
          findRetryButton(tree)?.props.onPress();
        });
      }

      // After 3 clicks, component should succeed
      texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Finally works!');
      expect(texts).not.toContain('Something went wrong');

      errorSpy.mockRestore();
    });

    it('fully resets state on retry (hasError: false, error: undefined)', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Use click-based control instead of render count
      let retryClicked = false;

      const ThrowsUntilRetry = () => {
        if (!retryClicked) {
          throw new Error('throws until retry clicked');
        }
        return <Text>State Reset Success</Text>;
      };

      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <GameErrorBoundary>
            <ThrowsUntilRetry />
          </GameErrorBoundary>
        );
      });

      // Error UI shown
      let texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Something went wrong');

      // Mark that retry was clicked
      retryClicked = true;

      // Retry resets state and re-renders child
      act(() => {
        findRetryButton(tree)?.props.onPress();
      });

      // Verify child renders successfully after state reset
      texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('State Reset Success');
      expect(texts).not.toContain('Something went wrong');

      errorSpy.mockRestore();
    });

    it('preserves error details until retry', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const capturedErrors: Error[] = [];

      // Capture errors logged to console
      errorSpy.mockImplementation((...args) => {
        if (args[0] === 'Game error:' && args[1] instanceof Error) {
          capturedErrors.push(args[1]);
        }
      });

      const ThrowsWithMessage = () => {
        throw new Error('Specific game error message');
      };

      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <GameErrorBoundary>
            <ThrowsWithMessage />
          </GameErrorBoundary>
        );
      });

      // Error was logged
      expect(capturedErrors.length).toBeGreaterThan(0);
      expect(capturedErrors[0].message).toBe('Specific game error message');

      // Error UI is shown
      const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Something went wrong');
      expect(texts).toContain('The game encountered an error.');

      errorSpy.mockRestore();
    });

    it('error boundary works with functional component children', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Use click-based control
      let retryClicked = false;

      const FunctionalWithHooks = () => {
        const [count] = useState(0);

        if (!retryClicked) {
          throw new Error('hook component error');
        }

        return <Text>Hook count: {count}</Text>;
      };

      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <GameErrorBoundary>
            <FunctionalWithHooks />
          </GameErrorBoundary>
        );
      });

      // Shows error
      let texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts).toContain('Something went wrong');

      // Mark retry clicked and retry
      retryClicked = true;
      act(() => {
        findRetryButton(tree)?.props.onPress();
      });

      // Functional component with hooks renders correctly
      texts = tree.root.findAllByType(Text).map((n) => n.props.children);
      expect(texts.join(' ')).toContain('Hook count:');

      errorSpy.mockRestore();
    });

    it('retry button is visible in error state', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const AlwaysThrows = () => {
        throw new Error('always throws');
      };

      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <GameErrorBoundary>
            <AlwaysThrows />
          </GameErrorBoundary>
        );
      });

      const retryButton = findRetryButton(tree);
      expect(retryButton).toBeDefined();

      // Verify button text
      const buttonTexts = retryButton?.findAllByType(Text).map((n) => n.props.children);
      expect(buttonTexts).toContain('Try Again');

      errorSpy.mockRestore();
    });
  });
});
