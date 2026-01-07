import { useCallback, useEffect, useRef } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useGameStore } from '../stores/gameStore';
import { parseNumeric } from '../utils';
import { initAnalytics, setAnalyticsContext, track } from '../services/analytics';
import type { GameMessage } from '@nullspace/protocol/mobile';

// Time in ms before faucet status resets from 'success' to 'idle'
const FAUCET_SUCCESS_RESET_MS = 3000;

export function useGatewaySession() {
  const {
    connectionState,
    send,
    lastMessage,
  } = useWebSocketContext(); // Returns WebSocketManager<GameMessage>
  const setBalance = useGameStore((state) => state.setBalance);
  const setBalanceReady = useGameStore((state) => state.setBalanceReady);
  const setSessionInfo = useGameStore((state) => state.setSessionInfo);
  const setFaucetStatus = useGameStore((state) => state.setFaucetStatus);
  const faucetStatus = useGameStore((state) => state.faucetStatus);

  const lastSessionIdRef = useRef<string | null>(null);
  const faucetResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void initAnalytics();
  }, []);

  // Cleanup faucet reset timeout on unmount
  useEffect(() => {
    return () => {
      if (faucetResetTimeoutRef.current) {
        clearTimeout(faucetResetTimeoutRef.current);
        faucetResetTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (connectionState === 'connected') {
      send({ type: 'get_balance' });
    }
  }, [connectionState, send]);

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'session_ready') {
      // Type assertion: session_ready messages have these fields
      const msg = lastMessage as typeof lastMessage & {
        sessionId: string;
        publicKey: string;
        registered: boolean;
        hasBalance: boolean;
        balance: string;
      };

      lastSessionIdRef.current = msg.sessionId;
      setSessionInfo({
        sessionId: msg.sessionId,
        publicKey: msg.publicKey,
        registered: msg.registered,
        hasBalance: msg.hasBalance,
      });
      setAnalyticsContext({ publicKey: msg.publicKey });
      void track('casino.session.started', {
        source: 'mobile',
        registered: msg.registered,
        hasBalance: msg.hasBalance,
      });
      const readyBalance = parseNumeric(msg.balance);
      if (readyBalance !== null) {
        setBalance(readyBalance);
        setBalanceReady(true);
      }
      send({ type: 'get_balance' });
      return;
    }

    if (lastMessage.type === 'balance') {
      // Type assertion: balance messages have these fields
      const msg = lastMessage as typeof lastMessage & {
        publicKey: string;
        registered: boolean;
        hasBalance: boolean;
        balance: string;
        message?: string;
      };

      setSessionInfo({
        publicKey: msg.publicKey,
        registered: msg.registered,
        hasBalance: msg.hasBalance,
      });
      const balanceValue = parseNumeric(msg.balance);
      if (balanceValue !== null) {
        setBalance(balanceValue);
        setBalanceReady(true);
      }
      if (msg.message === 'FAUCET_CLAIMED') {
        setFaucetStatus('success', 'Faucet claimed');
        void track('casino.faucet.claimed', { source: 'mobile' });

        // Clear any existing timeout
        if (faucetResetTimeoutRef.current) {
          clearTimeout(faucetResetTimeoutRef.current);
        }

        // Auto-reset to idle after a brief success display
        faucetResetTimeoutRef.current = setTimeout(() => {
          // Only reset if still in success state (user might have started a new request)
          if (useGameStore.getState().faucetStatus === 'success') {
            setFaucetStatus('idle', null);
          }
          faucetResetTimeoutRef.current = null;
        }, FAUCET_SUCCESS_RESET_MS);
      }
      return;
    }

    if (lastMessage.type === 'game_started') {
      // Type assertion: game_started messages have these fields
      const msg = lastMessage as typeof lastMessage & {
        gameType: string;
        bet: string;
        sessionId: string;
        balance: string;
      };

      void track('casino.game.started', {
        source: 'mobile',
        gameType: msg.gameType,
        bet: parseNumeric(msg.bet),
        sessionId: msg.sessionId,
      });
      const balanceValue = parseNumeric(msg.balance);
      if (balanceValue !== null) {
        setBalance(balanceValue);
        setBalanceReady(true);
      }
      return;
    }

    if (
      lastMessage.type === 'live_table_state'
      || lastMessage.type === 'live_table_result'
      || lastMessage.type === 'live_table_confirmation'
    ) {
      // Type assertion: live table messages have balance field
      const msg = lastMessage as typeof lastMessage & {
        balance: string;
      };

      const balanceValue = parseNumeric(msg.balance);
      if (balanceValue !== null) {
        setBalance(balanceValue);
        setBalanceReady(true);
      }
      return;
    }

    if (lastMessage.type === 'game_result' || lastMessage.type === 'game_move') {
      if (lastMessage.type === 'game_result') {
        // Type assertion: game_result messages have these fields
        const msg = lastMessage as typeof lastMessage & {
          gameType: string;
          won: boolean;
          payout: string;
          finalChips: string;
          sessionId: string;
          balance?: string;
        };

        void track('casino.game.completed', {
          source: 'mobile',
          gameType: msg.gameType,
          won: msg.won,
          payout: parseNumeric(msg.payout),
          finalChips: parseNumeric(msg.finalChips),
          sessionId: msg.sessionId,
        });

        const balanceValue = parseNumeric(msg.balance ?? msg.finalChips);
        if (balanceValue !== null) {
          setBalance(balanceValue);
          setBalanceReady(true);
        }
      } else {
        // game_move
        const msg = lastMessage as typeof lastMessage & {
          balance?: string;
          finalChips?: string;
        };

        const balanceValue = parseNumeric(msg.balance ?? msg.finalChips);
        if (balanceValue !== null) {
          setBalance(balanceValue);
          setBalanceReady(true);
        }
      }
    }

    if (lastMessage.type === 'error' && faucetStatus === 'pending') {
      // Type assertion: error messages have message field
      const msg = lastMessage as typeof lastMessage & {
        message?: string;
      };

      setFaucetStatus('error', msg.message ?? 'Request failed');
    }
  }, [lastMessage, send, setBalance, setBalanceReady, setSessionInfo, setFaucetStatus, faucetStatus]);

  const requestFaucet = useCallback((amount?: number) => {
    setFaucetStatus('pending', 'Requesting faucet...');
    if (typeof amount === 'number' && amount > 0) {
      send({ type: 'faucet_claim', amount });
    } else {
      send({ type: 'faucet_claim' });
    }
  }, [send, setFaucetStatus]);

  return {
    requestFaucet,
    connectionState,
    sessionId: lastSessionIdRef.current,
  };
}
