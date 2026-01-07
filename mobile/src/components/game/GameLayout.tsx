/**
 * GameLayout - Shared layout component for game screens
 * Provides consistent header, connection status, error recovery, and content area
 *
 * US-120: Enhanced error state recovery UX with visual feedback
 */
import React, { ReactNode, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { GameHeader } from './GameHeader';
import { ConnectionStatusBanner } from '../ui/ConnectionStatusBanner';
import { CelebrationOverlay } from '../celebration/CelebrationOverlay';
import { ErrorRecoveryOverlay, ErrorType, RecoveryState } from '../ui/ErrorRecoveryOverlay';
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

/**
 * Game error state for error recovery overlay (US-120)
 */
export interface GameErrorState {
  /** Whether there's an active error */
  hasError: boolean;
  /** Type of error for appropriate UI */
  errorType: ErrorType;
  /** Error message to display */
  message: string;
  /** Callback when retry is pressed */
  onRetry?: () => void;
  /** Callback to navigate back to lobby */
  onGoToLobby?: () => void;
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
  /** Game error state for error recovery overlay (US-120) */
  gameError?: GameErrorState;
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
  gameError,
}: GameLayoutProps) {
  const [sessionStartBalance] = useState(balance);
  const sessionDelta = balance - sessionStartBalance;

  // Derive error overlay state from connection status and/or game error
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('idle');

  // Map connection state to error overlay when disconnected
  const isConnectionError = connectionStatus &&
    (connectionStatus.connectionState === 'failed' ||
     connectionStatus.connectionState === 'disconnected');

  const isConnecting = connectionStatus?.connectionState === 'connecting';

  // Determine what error to show (game error takes precedence over connection)
  const hasError = gameError?.hasError || isConnectionError;
  const errorType: ErrorType = gameError?.hasError
    ? gameError.errorType
    : isConnectionError
      ? 'network'
      : 'unknown';
  const errorMessage = gameError?.hasError
    ? gameError.message
    : isConnectionError
      ? 'Unable to connect to game server'
      : '';

  // Update recovery state based on connection changes
  useEffect(() => {
    if (isConnecting) {
      setRecoveryState('recovering');
    } else if (connectionStatus?.connectionState === 'connected' && recoveryState === 'recovering') {
      setRecoveryState('success');
    } else if (isConnectionError) {
      setRecoveryState('idle');
    }
  }, [connectionStatus?.connectionState, isConnecting, isConnectionError, recoveryState]);

  // Handle error overlay actions
  const handleReconnect = useCallback(() => {
    connectionStatus?.onRetry?.();
  }, [connectionStatus]);

  const handleRetry = useCallback(() => {
    gameError?.onRetry?.();
  }, [gameError]);

  const handleGoToLobby = useCallback(() => {
    gameError?.onGoToLobby?.();
  }, [gameError]);

  const handleErrorDismiss = useCallback(() => {
    setRecoveryState('idle');
  }, []);

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
      {/* ConnectionStatusBanner for simple connection feedback */}
      {connectionStatus && !hasError && (
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

      {/* Error recovery overlay (US-120) */}
      <ErrorRecoveryOverlay
        isVisible={hasError ?? false}
        errorType={errorType}
        message={errorMessage}
        recoveryState={recoveryState}
        onReconnect={isConnectionError ? handleReconnect : undefined}
        onRetry={gameError?.hasError ? handleRetry : undefined}
        onGoToLobby={handleGoToLobby}
        onDismiss={handleErrorDismiss}
        testID="game-error-overlay"
      />
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
