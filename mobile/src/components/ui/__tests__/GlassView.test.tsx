import React from 'react';
import { create, act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { GlassView, GlassOverlay } from '../GlassView';

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

const mockUseTheme = jest.requireMock('../../../context/ThemeContext').useTheme;

describe('GlassView', () => {
  beforeEach(() => {
    mockUseTheme.mockReturnValue({
      isDark: false,
      colorScheme: 'light',
    });
  });

  it('renders children correctly', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassView>
          <Text>Glass content</Text>
        </GlassView>
      );
    });

    const textNode = tree.root.findByType(Text);
    expect(textNode.props.children).toBe('Glass content');
  });

  it('renders BlurView with correct intensity', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassView intensity="heavy">
          <Text>Content</Text>
        </GlassView>
      );
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-intensity']).toBe(30);
  });

  it('uses light tint in light mode by default', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassView>
          <Text>Content</Text>
        </GlassView>
      );
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-tint']).toBe('light');
  });

  it('uses dark tint in dark mode', () => {
    mockUseTheme.mockReturnValue({
      isDark: true,
      colorScheme: 'dark',
    });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassView>
          <Text>Content</Text>
        </GlassView>
      );
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-tint']).toBe('dark');
  });

  it('respects forced tint override', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassView tint="dark">
          <Text>Content</Text>
        </GlassView>
      );
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-tint']).toBe('dark');
  });

  it('renders with glow when withGlow is true in dark mode', () => {
    mockUseTheme.mockReturnValue({
      isDark: true,
      colorScheme: 'dark',
    });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassView withGlow testID="glass-container">
          <Text>Content</Text>
        </GlassView>
      );
    });

    // Just verify it renders the container with testID
    const container = tree.root.findByProps({ testID: 'glass-container' });
    expect(container).toBeTruthy();

    // And renders the inner glow element (for elevated surfaces)
    const allViews = tree.root.findAllByType(View);
    expect(allViews.length).toBeGreaterThan(2); // container, blur, innerBorder, innerGlow, content
  });

  it('uses medium intensity by default', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GlassView>
          <Text>Content</Text>
        </GlassView>
      );
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-intensity']).toBe(20);
  });
});

describe('GlassOverlay', () => {
  beforeEach(() => {
    mockUseTheme.mockReturnValue({
      isDark: false,
      colorScheme: 'light',
    });
  });

  it('renders BlurView with correct intensity', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<GlassOverlay testID="overlay" />);
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-intensity']).toBe(20);
  });

  it('respects custom intensity', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<GlassOverlay intensity="heavy" testID="overlay" />);
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-intensity']).toBe(30);
  });

  it('uses dark tint in dark mode', () => {
    mockUseTheme.mockReturnValue({
      isDark: true,
      colorScheme: 'dark',
    });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<GlassOverlay testID="overlay" />);
    });

    const blurView = tree.root.findByProps({ testID: 'blur-view' });
    expect(blurView.props['data-tint']).toBe('dark');
  });
});
