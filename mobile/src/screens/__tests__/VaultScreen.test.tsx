import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { PremiumInput, PrimaryButton } from '../../components/ui';
import { VaultScreen } from '../VaultScreen';
import * as vault from '../../services/vault';

jest.mock('../../services/vault', () => ({
  createPasswordVault: jest.fn(async () => undefined),
  deleteVault: jest.fn(async () => undefined),
  exportVaultPrivateKey: jest.fn(async () => 'key'),
  getVaultStatus: jest.fn(async () => ({ enabled: false, unlocked: false, publicKeyHex: null })),
  importVaultPrivateKey: jest.fn(async () => undefined),
  lockVault: jest.fn(),
  unlockPasswordVault: jest.fn(async () => undefined),
  VAULT_PASSWORD_MIN_LENGTH: 12,
}));

describe('VaultScreen', () => {
  const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders vault screen', async () => {
    const navigation = { goBack: jest.fn() } as any;
    const route = { key: 'vault-1', name: 'Vault' as const };

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<VaultScreen navigation={navigation} route={route} />);
      await flushPromises();
    });
    expect(tree!.toJSON()).toBeTruthy();
  });

  it('shows password mismatch error on create', async () => {
    const navigation = { goBack: jest.fn() } as any;
    const route = { key: 'vault-1', name: 'Vault' as const };
    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<VaultScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    const inputs = tree!.root.findAllByType(PremiumInput);
    const createInput = inputs.find((node) => node.props.label === 'Create password')!;
    const confirmInput = inputs.find((node) => node.props.label === 'Confirm password')!;

    act(() => {
      createInput.props.onChangeText('secret-1');
      confirmInput.props.onChangeText('secret-2');
    });

    const createButton = tree!.root
      .findAllByType(PrimaryButton)
      .find((node) => node.props.label === 'Create vault')!;

    await act(async () => {
      await createButton.props.onPress();
      await flushPromises();
    });

    expect(vault.createPasswordVault).not.toHaveBeenCalled();
    const errorNodes = tree!.root.findAll(
      (node) =>
        node.type === Text &&
        typeof node.props.children === 'string' &&
        node.props.children.includes('Passwords do not match')
    );
    expect(errorNodes.length).toBeGreaterThan(0);
  });

  it('calls unlock when vault is enabled', async () => {
    (vault.getVaultStatus as jest.Mock).mockResolvedValueOnce({
      enabled: true,
      unlocked: false,
      publicKeyHex: 'abc123',
    });
    const navigation = { goBack: jest.fn() } as any;
    const route = { key: 'vault-1', name: 'Vault' as const };
    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<VaultScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    const unlockInput = tree!.root
      .findAllByType(PremiumInput)
      .find((node) => node.props.label === 'Vault password')!;

    act(() => {
      unlockInput.props.onChangeText('hunter2');
    });

    const unlockButton = tree!.root
      .findAllByType(PrimaryButton)
      .find((node) => node.props.label === 'Unlock')!;

    await act(async () => {
      await unlockButton.props.onPress();
      await flushPromises();
    });

    expect(vault.unlockPasswordVault).toHaveBeenCalledWith('hunter2');
  });

  it('shows password strength indicator when typing', async () => {
    const navigation = { goBack: jest.fn() } as any;
    const route = { key: 'vault-1', name: 'Vault' as const };
    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<VaultScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    const createInput = tree!.root
      .findAllByType(PremiumInput)
      .find((node) => node.props.label === 'Create password')!;

    act(() => {
      createInput.props.onChangeText('shortpw');
    });

    // Should show "more characters needed" warning for passwords under 12 chars
    const json = JSON.stringify(tree!.toJSON());
    expect(json).toContain('more characters needed');
  });

  it('creates vault with valid 12+ character password', async () => {
    const navigation = { goBack: jest.fn() } as any;
    const route = { key: 'vault-1', name: 'Vault' as const };
    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<VaultScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    const inputs = tree!.root.findAllByType(PremiumInput);
    const createInput = inputs.find((node) => node.props.label === 'Create password')!;
    const confirmInput = inputs.find((node) => node.props.label === 'Confirm password')!;
    const validPassword = 'securepassword123';

    act(() => {
      createInput.props.onChangeText(validPassword);
      confirmInput.props.onChangeText(validPassword);
    });

    const createButton = tree!.root
      .findAllByType(PrimaryButton)
      .find((node) => node.props.label === 'Create vault')!;

    await act(async () => {
      await createButton.props.onPress();
      await flushPromises();
    });

    expect(vault.createPasswordVault).toHaveBeenCalledWith(validPassword, { migrateLegacyKey: true });
  });
});
