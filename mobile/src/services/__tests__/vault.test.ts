import { webcrypto } from 'crypto';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

import {
  createPasswordVault,
  deleteVault,
  exportVaultPrivateKey,
  getVaultStatus,
  importVaultPrivateKey,
  lockVault,
  unlockPasswordVault,
} from '../vault';

beforeAll(() => {
  if (!global.crypto) {
    global.crypto = webcrypto as unknown as Crypto;
  }
});

beforeEach(() => {
  mockStore.clear();
  lockVault();
});

afterEach(async () => {
  await deleteVault();
});

describe('vault', () => {
  it('creates and unlocks a password vault', async () => {
    await createPasswordVault('correct-horse-battery-staple', { migrateLegacyKey: false });
    const status = await getVaultStatus();
    expect(status.enabled).toBe(true);
    expect(status.unlocked).toBe(true);
    expect(status.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);

    lockVault();
    const locked = await getVaultStatus();
    expect(locked.unlocked).toBe(false);

    await unlockPasswordVault('correct-horse-battery-staple');
    const unlocked = await getVaultStatus();
    expect(unlocked.unlocked).toBe(true);
  });

  it('exports and imports a recovery key', async () => {
    await createPasswordVault('test-password-123', { migrateLegacyKey: false });
    const original = await getVaultStatus();
    const recovery = await exportVaultPrivateKey();

    lockVault();
    await deleteVault();

    await importVaultPrivateKey('new-password-456', recovery, { overwrite: true });
    const restored = await getVaultStatus();
    expect(restored.enabled).toBe(true);
    expect(restored.publicKeyHex).toBe(original.publicKeyHex);
  });

  it('rejects incorrect passwords', async () => {
    await createPasswordVault('correct-password', { migrateLegacyKey: false });
    lockVault();
    await expect(unlockPasswordVault('wrong-password')).rejects.toThrow('vault_password_invalid');
  });
});
