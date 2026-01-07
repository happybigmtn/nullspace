import { View, Text, StyleSheet, TextInput, ScrollView, Pressable } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { PrimaryButton, PasswordStrengthIndicator } from '../components/ui';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../constants/theme';
import {
  createPasswordVault,
  deleteVault,
  exportVaultPrivateKey,
  getVaultStatus,
  importVaultPrivateKey,
  lockVault,
  unlockPasswordVault,
  VAULT_PASSWORD_MIN_LENGTH,
} from '../services/vault';
import type { VaultScreenProps } from '../navigation/types';

const maskKey = (value: string | null) => {
  if (!value) return '—';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const mapVaultError = (error: unknown): string => {
  if (error instanceof Error) {
    switch (error.message) {
      case 'password_too_short':
        return `Password must be at least ${VAULT_PASSWORD_MIN_LENGTH} characters.`;
      case 'vault_exists':
        return 'Vault already exists. Import to overwrite, or delete first.';
      case 'vault_missing':
        return 'No vault found on this device.';
      case 'vault_password_invalid':
        return 'Incorrect password. Please try again.';
      case 'vault_locked':
        return 'Unlock the vault before exporting the recovery key.';
      case 'invalid_private_key':
        return 'Recovery key is invalid. Paste the full 64-hex key.';
      case 'random_unavailable':
        return 'Secure randomness unavailable on this device.';
      case 'text_encoder_unavailable':
        return 'Text encoder unavailable on this device.';
      default:
        return error.message || 'Vault error.';
    }
  }
  return 'Vault error.';
};

export function VaultScreen({ navigation }: VaultScreenProps) {
  const [vaultEnabled, setVaultEnabled] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(null);
  const [createPassword, setCreatePassword] = useState('');
  const [createConfirm, setCreateConfirm] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importKey, setImportKey] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const status = await getVaultStatus();
    setVaultEnabled(status.enabled);
    setVaultUnlocked(status.unlocked);
    setPublicKeyHex(status.publicKeyHex);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const resetMessages = () => {
    setMessage(null);
    setError(null);
  };

  const handleCreateVault = useCallback(async () => {
    resetMessages();
    if (createPassword !== createConfirm) {
      setError('Passwords do not match.');
      return;
    }
    try {
      await createPasswordVault(createPassword, { migrateLegacyKey: true });
      setMessage('Vault created and unlocked. Save your recovery key.');
      setCreatePassword('');
      setCreateConfirm('');
      setRecoveryKey('');
      await refreshStatus();
    } catch (err) {
      setError(mapVaultError(err));
    }
  }, [createPassword, createConfirm, refreshStatus]);

  const handleUnlock = useCallback(async () => {
    resetMessages();
    try {
      await unlockPasswordVault(unlockPassword);
      setMessage('Vault unlocked.');
      setUnlockPassword('');
      await refreshStatus();
    } catch (err) {
      setError(mapVaultError(err));
    }
  }, [unlockPassword, refreshStatus]);

  const handleLock = useCallback(async () => {
    lockVault();
    setRecoveryKey('');
    await refreshStatus();
    setMessage('Vault locked.');
  }, [refreshStatus]);

  const handleExport = useCallback(async () => {
    resetMessages();
    try {
      const key = await exportVaultPrivateKey();
      setRecoveryKey(key);
      setMessage('Recovery key ready. Store it offline.');
    } catch (err) {
      setError(mapVaultError(err));
    }
  }, []);

  const handleImport = useCallback(async () => {
    resetMessages();
    try {
      await importVaultPrivateKey(importPassword, importKey, { overwrite: true });
      setMessage('Recovery key imported and vault unlocked.');
      setImportPassword('');
      setImportKey('');
      await refreshStatus();
    } catch (err) {
      setError(mapVaultError(err));
    }
  }, [importPassword, importKey, refreshStatus]);

  const handleDeleteVault = useCallback(async () => {
    resetMessages();
    try {
      await deleteVault();
      setRecoveryKey('');
      setMessage('Vault deleted on this device.');
      await refreshStatus();
    } catch (err) {
      setError(mapVaultError(err));
    }
  }, [refreshStatus]);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Vault</Text>
        <Text style={styles.subtitle}>Password vault + recovery key</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <Text style={styles.cardBody}>Vault: {vaultEnabled ? 'Enabled' : 'Not set'}</Text>
        <Text style={styles.cardBody}>Unlocked: {vaultUnlocked ? 'Yes' : 'No'}</Text>
        <Text style={styles.cardBody}>Public key: {maskKey(publicKeyHex)}</Text>
      </View>

      {message && (
        <View style={styles.noticeSuccess}>
          <Text style={styles.noticeText}>{message}</Text>
        </View>
      )}

      {error && (
        <View style={styles.noticeError}>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      )}

      {!vaultEnabled && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create vault</Text>
          <Text style={styles.cardBody}>Encrypt your key with a password.</Text>
          <TextInput
            placeholder="Create password"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            value={createPassword}
            onChangeText={setCreatePassword}
            style={styles.input}
          />
          <PasswordStrengthIndicator password={createPassword} />
          <TextInput
            placeholder="Confirm password"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            value={createConfirm}
            onChangeText={setCreateConfirm}
            style={styles.input}
          />
          <PrimaryButton label="Create vault" onPress={handleCreateVault} size="large" />
          <Text style={styles.helperText}>Minimum {VAULT_PASSWORD_MIN_LENGTH} characters.</Text>
        </View>
      )}

      {vaultEnabled && !vaultUnlocked && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Unlock vault</Text>
          <TextInput
            placeholder="Vault password"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            value={unlockPassword}
            onChangeText={setUnlockPassword}
            style={styles.input}
          />
          <PrimaryButton label="Unlock" onPress={handleUnlock} size="large" />
        </View>
      )}

      {vaultEnabled && vaultUnlocked && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recovery key</Text>
          <Text style={styles.cardBody}>Store offline. Anyone with this key can control the account.</Text>
          <PrimaryButton label="Show recovery key" onPress={handleExport} />
          {recoveryKey ? (
            <View style={styles.recoveryBox}>
              <Text style={styles.recoveryText}>{recoveryKey}</Text>
            </View>
          ) : null}
          <PrimaryButton label="Lock vault" onPress={handleLock} variant="secondary" />
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Import recovery key</Text>
        <Text style={styles.cardBody}>Replaces any vault on this device.</Text>
        <TextInput
          placeholder="Recovery key (64 hex)"
          placeholderTextColor={COLORS.textMuted}
          value={importKey}
          onChangeText={setImportKey}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <TextInput
          placeholder="New vault password"
          placeholderTextColor={COLORS.textMuted}
          secureTextEntry
          value={importPassword}
          onChangeText={setImportPassword}
          style={styles.input}
        />
        <PasswordStrengthIndicator password={importPassword} />
        <PrimaryButton label="Import & replace" onPress={handleImport} variant="danger" />
      </View>

      {vaultEnabled && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delete vault</Text>
          <Text style={styles.cardBody}>Removes the vault from this device only.</Text>
          <PrimaryButton label="Delete vault" onPress={handleDeleteVault} variant="danger" />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: SPACING.lg,
    paddingTop: 60,
    backgroundColor: COLORS.background,
  },
  header: {
    marginBottom: SPACING.lg,
  },
  backButton: {
    marginBottom: SPACING.sm,
  },
  backLabel: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.bodySmall,
  },
  title: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.h1,
  },
  subtitle: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.bodySmall,
    marginTop: SPACING.xs,
  },
  card: {
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.bodyLarge,
    marginBottom: SPACING.sm,
  },
  cardBody: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.bodySmall,
    marginBottom: SPACING.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.background,
    marginBottom: SPACING.sm,
  },
  helperText: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.bodySmall,
    marginTop: SPACING.sm,
  },
  noticeSuccess: {
    backgroundColor: COLORS.success + '20',
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.lg,
  },
  noticeError: {
    backgroundColor: COLORS.error + '20',
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.lg,
  },
  noticeText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.bodySmall,
  },
  recoveryBox: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  recoveryText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
