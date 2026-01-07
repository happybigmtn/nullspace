import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { WalletBadge } from '../WalletBadge';
import { useGameStore } from '../../../stores/gameStore';
import { getNetworkLabel } from '../../../utils';

jest.mock('../../../stores/gameStore', () => ({
  useGameStore: jest.fn(),
}));

jest.mock('../../../utils', () => ({
  getNetworkLabel: jest.fn(),
}));

const mockUseGameStore = useGameStore as jest.Mock;

describe('WalletBadge', () => {
  beforeEach(() => {
    (getNetworkLabel as jest.Mock).mockReturnValue('Testnet');
  });

  it('renders nothing without public key', () => {
    mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
      selector({ publicKey: null })
    );
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<WalletBadge />);
    });

    expect(tree.root.findAllByType(Text).length).toBe(0);
  });

  it('renders network and shortened key', () => {
    mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
      selector({ publicKey: 'abcdef1234567890' })
    );
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<WalletBadge />);
    });

    const text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    expect(text).toContain('Testnet');
    expect(text).toContain('abcdef...7890');
  });

  describe('short key edge cases', () => {
    it('handles publicKey shorter than 10 characters without duplicate chars', () => {
      // Key is 8 chars - too short for truncation, should show full key
      mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
        selector({ publicKey: '12345678' })
      );
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<WalletBadge />);
      });

      const keyText = tree.root.findAllByType(Text).map((node) => node.props.children).find(
        (text: string) => typeof text === 'string' && !text.includes('Testnet')
      );

      // Short keys should be shown in full without ellipsis
      expect(keyText).toBe('12345678');
    });

    it('handles empty string publicKey', () => {
      mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
        selector({ publicKey: '' })
      );
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<WalletBadge />);
      });

      // Empty string should either not render or show something sensible
      const textNodes = tree.root.findAllByType(Text);
      // If it renders, the key portion should be empty or minimal
      const texts = textNodes.map((node) => node.props.children);
      const keyText = texts.find(
        (text: string) => typeof text === 'string' && !text.includes('Testnet')
      );
      // Should not throw and should handle gracefully
      expect(keyText === undefined || keyText === '' || keyText === '...').toBe(true);
    });

    it('handles exactly 10 character publicKey (below truncation threshold)', () => {
      // Key is exactly 10 chars - below 11 char minimum for truncation
      // Should show full key to avoid overlap
      mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
        selector({ publicKey: '1234567890' })
      );
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<WalletBadge />);
      });

      const keyText = tree.root.findAllByType(Text).map((node) => node.props.children).find(
        (text: string) => typeof text === 'string' && !text.includes('Testnet')
      );

      // 10 chars is still below threshold, show full key
      expect(keyText).toBe('1234567890');
    });

    it('handles exactly 11 character publicKey (at truncation threshold)', () => {
      // Key is exactly 11 chars - this is the minimum for truncation
      // slice(0,6)="12345A", slice(-4)="BCDE" -> "12345A...BCDE" (no overlap)
      mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
        selector({ publicKey: '12345ABCDEF' })
      );
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<WalletBadge />);
      });

      const keyText = tree.root.findAllByType(Text).map((node) => node.props.children).find(
        (text: string) => typeof text === 'string' && !text.includes('Testnet')
      );

      // 11 chars: first 6 + last 4 = 10, with 1 char hidden (the 'B')
      expect(keyText).toBe('12345A...CDEF');
    });

    it('handles 4 character publicKey (very short)', () => {
      // Key is 4 chars - too short for truncation, should show full key
      mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
        selector({ publicKey: '1234' })
      );
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<WalletBadge />);
      });

      const keyText = tree.root.findAllByType(Text).map((node) => node.props.children).find(
        (text: string) => typeof text === 'string' && !text.includes('Testnet')
      );

      // Short keys should be shown in full without ellipsis
      expect(keyText).toBe('1234');
    });

    it('handles single character publicKey', () => {
      // Key is 1 char - too short for truncation, should show full key
      mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
        selector({ publicKey: 'A' })
      );
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<WalletBadge />);
      });

      const keyText = tree.root.findAllByType(Text).map((node) => node.props.children).find(
        (text: string) => typeof text === 'string' && !text.includes('Testnet')
      );

      // Single char should be shown as-is
      expect(keyText).toBe('A');
    });

    it('normal 64-char hex key works correctly', () => {
      const fullKey = '0x' + 'a'.repeat(40); // Standard Ethereum-style address
      mockUseGameStore.mockImplementation((selector: (state: { publicKey: string | null }) => unknown) =>
        selector({ publicKey: fullKey })
      );
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<WalletBadge />);
      });

      const keyText = tree.root.findAllByType(Text).map((node) => node.props.children).find(
        (text: string) => typeof text === 'string' && !text.includes('Testnet')
      );

      expect(keyText).toBe('0xaaaa...aaaa');
    });
  });
});
