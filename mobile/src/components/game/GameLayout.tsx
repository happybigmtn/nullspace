/**
 * GameLayout - Shared layout component for game screens
 * Provides consistent header, connection status, and content area
 */
import React, { ReactNode, useState } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { GameHeader } from './GameHeader';
import { ConnectionStatusBanner } from '../ui/ConnectionStatusBanner';
import { CelebrationOverlay } from '../celebration/CelebrationOverlay';
import { COLORS } from '../../constants/theme';
import type { ConnectionState } from '../../services/websocket';
import type { CelebrationState } from '../../hooks/useCelebration';

const SCANLINE_ROWS = Array.from({ length: 80 }, (_, index) => index);

interface ConnectionStatus {
  connectionState: ConnectionState;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  onRetry?: () => void;
}

interface GameLayoutProps {
  title: string;
  balance: number;
  onHelpPress?: () => void;
  headerRightContent?: ReactNode;
  connectionStatus?: ConnectionStatus;
  children: ReactNode;
  /** Celebration state for win effects */
  celebrationState?: CelebrationState;
  /** Callback when celebration animation completes */
  onCelebrationComplete?: () => void;
}

export function GameLayout({
  title,
  balance,
  onHelpPress,
  headerRightContent,
  connectionStatus,
  children,
  celebrationState,
  onCelebrationComplete,
}: GameLayoutProps) {
  const [sessionStartBalance] = useState(balance);
  const sessionDelta = balance - sessionStartBalance;

  return (
    <SafeAreaView style={styles.container}>
      <View pointerEvents="none" style={styles.scanlineOverlay}>
        {SCANLINE_ROWS.map((row) => (
          <View key={row} style={styles.scanline} />
        ))}
      </View>
      {celebrationState && (
        <CelebrationOverlay state={celebrationState} onComplete={onCelebrationComplete} />
      )}
      {connectionStatus && (
        <ConnectionStatusBanner
          connectionState={connectionStatus.connectionState}
          reconnectAttempt={connectionStatus.reconnectAttempt}
          maxReconnectAttempts={connectionStatus.maxReconnectAttempts}
          onRetry={connectionStatus.onRetry}
        />
      )}
      <GameHeader
        title={title}
        balance={balance}
        sessionDelta={sessionDelta}
        onHelp={onHelpPress}
        rightContent={headerRightContent}
        isWinCelebrating={celebrationState?.isActive}
        celebrationIntensity={celebrationState?.intensity}
        winAmount={celebrationState?.winAmount}
      />
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scanlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    opacity: 0.12,
  },
  scanline: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  content: {
    flex: 1,
  },
});
