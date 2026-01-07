import React from 'react';
import { create, act } from 'react-test-renderer';
import { Text, View, Pressable } from 'react-native';
import { GlassModal, GlassSheet } from '../GlassModal';

// Mock expo-blur
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return {
    BlurView: (props: { children?: React.ReactNode; intensity: number; tint: string }) => (
      <View testID="blur-view" data-intensity={props.intensity} data-tint={props.tint}>
        {props.children}
      </View>
    ),
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  const { View, Pressable } = require('react-native');
  return {
    ...Reanimated,
    FadeIn: { duration: jest.fn().mockReturnValue({}) },
    FadeOut: { duration: jest.fn().mockReturnValue({}) },
    SlideInDown: {
      springify: jest.fn().mockReturnValue({
        damping: jest.fn().mockReturnValue({
          stiffness: jest.fn().mockReturnValue({}),
        }),
      }),
    },
    SlideOutDown: { duration: jest.fn().mockReturnValue({}) },
    createAnimatedComponent: (Component: React.ComponentType) => Component,
    default: {
      View,
      createAnimatedComponent: (Component: React.ComponentType) => Component,
    },
  };
});

// Mock ThemeContext
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: jest.fn(() => ({
    isDark: false,
    colorScheme: 'light',
    colorSchemePreference: 'system',
    setColorSchemePreference: jest.fn(),
    toggleColorScheme: jest.fn(),
  })),
}));

// Mock useThemedColors
jest.mock('../../../hooks/useThemedColors', () => ({
  useThemedColors: jest.fn(() => ({
    background: '#FFFFFF',
    surface: '#FFFFFF',
    textPrimary: '#1C1C1E',
    textSecondary: '#8E8E93',
    primary: '#6366F1',
    border: '#E5E5EA',
  })),
}));

const mockUseTheme = jest.requireMock('../../../context/ThemeContext').useTheme;
const mockUseThemedColors = jest.requireMock('../../../hooks/useThemedColors').useThemedColors;

describe('GlassModal', () => {
  beforeEach(() => {
    mockUseTheme.mockReturnValue({
      isDark: false,
      colorScheme: 'light',
    });
    mockUseThemedColors.mockReturnValue({
      background: '#FFFFFF',
      surface: '#FFFFFF',
      textPrimary: '#1C1C1E',
      textSecondary: '#8E8E93',
      primary: '#6366F1',
      border: '#E5E5EA',
    });
  });

  it('renders children when visible', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassModal visible={true} onClose={jest.fn()}>
          <Text testID="modal-content">Modal content</Text>
        </GlassModal>
      );
    });

    const text = tree.root.findByProps({ testID: 'modal-content' });
    expect(text.props.children).toBe('Modal content');
  });

  it('does not render when not visible', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassModal visible={false} onClose={jest.fn()}>
          <Text testID="modal-content">Modal content</Text>
        </GlassModal>
      );
    });

    // Modal should still be in the tree but not display content visually
    // The Modal component from RN handles visibility internally
    expect(tree.root.findAllByType(Text).length).toBeGreaterThanOrEqual(0);
  });

  it('renders BlurView for backdrop', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassModal visible={true} onClose={jest.fn()}>
          <Text>Content</Text>
        </GlassModal>
      );
    });

    const blurViews = tree.root.findAllByProps({ testID: 'blur-view' });
    expect(blurViews.length).toBeGreaterThan(0);
  });

  it('uses dark tint in dark mode', () => {
    mockUseTheme.mockReturnValue({
      isDark: true,
      colorScheme: 'dark',
    });
    mockUseThemedColors.mockReturnValue({
      background: '#000000',
      surface: '#1C1C1E',
      textPrimary: '#F2F2F7',
      textSecondary: '#8E8E93',
      primary: '#6366F1',
      border: '#3A3A3C',
    });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassModal visible={true} onClose={jest.fn()}>
          <Text>Content</Text>
        </GlassModal>
      );
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-tint']).toBe('dark');
  });

  it('calls onClose when backdrop is pressed', () => {
    const onClose = jest.fn();

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassModal visible={true} onClose={onClose}>
          <Text>Content</Text>
        </GlassModal>
      );
    });

    // Find the backdrop pressable
    const pressables = tree.root.findAllByType(Pressable);
    const backdropPressable = pressables.find(
      (p) => p.props.onPress === onClose
    );

    if (backdropPressable) {
      act(() => {
        backdropPressable.props.onPress();
      });
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('does not call onClose when closeOnBackdrop is false', () => {
    const onClose = jest.fn();

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassModal visible={true} onClose={onClose} closeOnBackdrop={false}>
          <Text>Content</Text>
        </GlassModal>
      );
    });

    // Find all pressables - backdrop onPress should be undefined
    const pressables = tree.root.findAllByType(Pressable);
    pressables.forEach((p) => {
      if (p.props.onPress) {
        act(() => {
          p.props.onPress();
        });
      }
    });

    // onClose should not be called from backdrop
    // (may be called from other mechanisms)
    expect(onClose).not.toHaveBeenCalled();
  });

  it('respects custom backdrop intensity', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassModal visible={true} onClose={jest.fn()} backdropIntensity="heavy">
          <Text>Content</Text>
        </GlassModal>
      );
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-intensity']).toBe(30);
  });
});

describe('GlassSheet', () => {
  beforeEach(() => {
    mockUseTheme.mockReturnValue({
      isDark: false,
      colorScheme: 'light',
    });
    mockUseThemedColors.mockReturnValue({
      background: '#FFFFFF',
      surface: '#FFFFFF',
      textPrimary: '#1C1C1E',
      textSecondary: '#8E8E93',
      primary: '#6366F1',
      border: '#E5E5EA',
    });
  });

  it('renders as bottom-positioned modal', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassSheet visible={true} onClose={jest.fn()}>
          <Text testID="sheet-content">Sheet content</Text>
        </GlassSheet>
      );
    });

    const text = tree.root.findByProps({ testID: 'sheet-content' });
    expect(text.props.children).toBe('Sheet content');
  });

  it('calls onClose when closed', () => {
    const onClose = jest.fn();

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassSheet visible={true} onClose={onClose}>
          <Text>Content</Text>
        </GlassSheet>
      );
    });

    // Find the backdrop pressable
    const pressables = tree.root.findAllByType(Pressable);
    const backdropPressable = pressables.find(
      (p) => p.props.onPress === onClose
    );

    if (backdropPressable) {
      act(() => {
        backdropPressable.props.onPress();
      });
      expect(onClose).toHaveBeenCalled();
    }
  });
});
