import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { GameScreen } from '../GameScreen';
import { haptics } from '../../services/haptics';

jest.mock('../../services/haptics', () => ({
  haptics: { buttonPress: jest.fn(() => Promise.resolve()) },
}));

jest.mock('../../components/game', () => ({
  GameErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../games/HiLoScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { HiLoScreen: () => React.createElement(Text, null, 'HiLo') };
});
jest.mock('../games/BlackjackScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { BlackjackScreen: () => React.createElement(Text, null, 'Blackjack') };
});
jest.mock('../games/RouletteScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { RouletteScreen: () => React.createElement(Text, null, 'Roulette') };
});
jest.mock('../games/CrapsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { CrapsScreen: () => React.createElement(Text, null, 'Craps') };
});
jest.mock('../games/CasinoWarScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { CasinoWarScreen: () => React.createElement(Text, null, 'CasinoWar') };
});
jest.mock('../games/VideoPokerScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { VideoPokerScreen: () => React.createElement(Text, null, 'VideoPoker') };
});
jest.mock('../games/BaccaratScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { BaccaratScreen: () => React.createElement(Text, null, 'Baccarat') };
});
jest.mock('../games/SicBoScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { SicBoScreen: () => React.createElement(Text, null, 'SicBo') };
});
jest.mock('../games/ThreeCardPokerScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { ThreeCardPokerScreen: () => React.createElement(Text, null, 'ThreeCardPoker') };
});
jest.mock('../games/UltimateTXHoldemScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { UltimateTXHoldemScreen: () => React.createElement(Text, null, 'UltimateHoldem') };
});

describe('GameScreen', () => {
  const renderScreen = (route: { params: { gameId: string } }) => {
    const navigation = { goBack: jest.fn() } as const;
    let tree: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GameScreen navigation={navigation} route={{ key: 'Game', name: 'Game', ...route }} />
      );
    });
    return { tree: tree!, navigation };
  };

  it('renders error state for unknown game', () => {
    const { tree } = renderScreen({ params: { gameId: 'unknown' } });

    const text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    expect(text).toContain('Game not found');
  });

  it('renders game component and handles back press', () => {
    const { tree, navigation } = renderScreen({ params: { gameId: 'hi_lo' } });

    const text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    expect(text).toContain('HiLo');

    const pressables = tree.root.findAll((node) => typeof node.props.onPress === 'function');
    expect(pressables.length).toBeGreaterThan(0);
    act(() => {
      pressables[0].props.onPress();
    });

    expect(haptics.buttonPress).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
