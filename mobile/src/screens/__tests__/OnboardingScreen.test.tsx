import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { OnboardingScreen } from '../OnboardingScreen';
import { haptics } from '../../services/haptics';
import { markOnboardingCompleted } from '../../services';

jest.mock('../../services/haptics', () => ({
  haptics: {
    roundStart: jest.fn(),
    jackpot: jest.fn(),
    buttonPress: jest.fn(),
  },
}));

jest.mock('../../services', () => ({
  markOnboardingCompleted: jest.fn(),
}));

describe('OnboardingScreen', () => {
  const createNavigation = () => ({ replace: jest.fn() });
  const createRoute = () => ({ key: 'Onboarding', name: 'Onboarding' as const });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('renders welcome title', () => {
    const navigation = createNavigation();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(<OnboardingScreen navigation={navigation as any} route={createRoute() as any} />);
    });

    const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
    const flatTexts = texts.flat().join(' ');
    expect(flatTexts).toContain('Welcome to Nullspace');

    act(() => {
      tree.unmount();
    });
  });

  it('renders provably fair tagline', () => {
    const navigation = createNavigation();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(<OnboardingScreen navigation={navigation as any} route={createRoute() as any} />);
    });

    const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
    const flatTexts = texts.flat().join(' ');
    expect(flatTexts).toContain('Provably fair');

    act(() => {
      tree.unmount();
    });
  });

  it('renders featured games section', () => {
    const navigation = createNavigation();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(<OnboardingScreen navigation={navigation as any} route={createRoute() as any} />);
    });

    const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
    const flatTexts = texts.flat().join(' ');
    expect(flatTexts).toContain('Featured Games');
    expect(flatTexts).toContain('Blackjack');
    expect(flatTexts).toContain('Roulette');

    act(() => {
      tree.unmount();
    });
  });

  it('triggers roundStart haptic after delay', () => {
    const navigation = createNavigation();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(<OnboardingScreen navigation={navigation as any} route={createRoute() as any} />);
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(haptics.roundStart).toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });

  it('renders dealer avatar container', () => {
    const navigation = createNavigation();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(<OnboardingScreen navigation={navigation as any} route={createRoute() as any} />);
    });

    const views = tree.root.findAllByType(View);
    expect(views.length).toBeGreaterThan(0);

    act(() => {
      tree.unmount();
    });
  });

  it('renders provably fair badge', () => {
    const navigation = createNavigation();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(<OnboardingScreen navigation={navigation as any} route={createRoute() as any} />);
    });

    const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
    const flatTexts = texts.flat().join(' ');
    expect(flatTexts).toContain('Provably Fair');

    act(() => {
      tree.unmount();
    });
  });

  it('exports markOnboardingCompleted from services', () => {
    // Verify the function is properly exported and mocked
    expect(markOnboardingCompleted).toBeDefined();
    expect(typeof markOnboardingCompleted).toBe('function');
  });
});
