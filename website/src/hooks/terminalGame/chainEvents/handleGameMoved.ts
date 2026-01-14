import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { CasinoGameMovedEvent } from '@nullspace/types/casino';
import type { CasinoChainService } from '../../../services/CasinoChainService';
import type { CasinoClient } from '../../../api/client';
import { GameState, GameType, PlayerStats } from '../../../types';
import { logDebug } from '../../../utils/logger';
import { parseCrapsChainRollLog } from '../../../services/games';
import type { CrapsChainRollLog } from '../../../services/games';

type CrapsPendingRollLog = {
  sessionId: bigint;
  prevDice: [number, number] | null;
  point: number | null;
  bets: any[];
} | null;

type CrapsChainRollRef = MutableRefObject<{ sessionId: bigint; roll: CrapsChainRollLog } | null>;

type HandleGameMovedArgs = {
  chainService: CasinoChainService;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  gameTypeRef: MutableRefObject<GameType>;
  gameStateRef: MutableRefObject<GameState | null>;
  isPendingRef: MutableRefObject<boolean>;
  pendingMoveCountRef: MutableRefObject<number>;
  crapsPendingRollLogRef: MutableRefObject<CrapsPendingRollLog>;
  crapsChainRollLogRef: CrapsChainRollRef;
  applySessionMeta: (sessionId: bigint | null, moveNumber?: number) => void;
  parseGameState: (stateBlob: Uint8Array | string, gameType?: GameType) => void;
  playModeRef: MutableRefObject<'CASH' | 'FREEROLL' | null>;
  clientRef: MutableRefObject<CasinoClient | null>;
  publicKeyBytesRef: MutableRefObject<Uint8Array | null>;
  lastBalanceUpdateRef: MutableRefObject<number>;
  currentChipsRef: MutableRefObject<number>;
  lastPlayerSyncRef: MutableRefObject<number>;
  playerSyncMinIntervalMs: number;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  setGameState: Dispatch<SetStateAction<GameState>>;
  setWalletRng: Dispatch<SetStateAction<number | null>>;
  setWalletVusdt: Dispatch<SetStateAction<number | null>>;
  setWalletCredits: Dispatch<SetStateAction<number | null>>;
  setWalletCreditsLocked: Dispatch<SetStateAction<number | null>>;
  setLastTxSig: (sig: string | null) => void;
};

export const createGameMovedHandler = ({
  chainService,
  currentSessionIdRef,
  gameTypeRef,
  gameStateRef,
  isPendingRef,
  pendingMoveCountRef,
  crapsPendingRollLogRef,
  crapsChainRollLogRef,
  applySessionMeta,
  parseGameState,
  playModeRef,
  clientRef,
  publicKeyBytesRef,
  lastBalanceUpdateRef,
  currentChipsRef,
  lastPlayerSyncRef,
  playerSyncMinIntervalMs,
  setStats,
  setGameState,
  setWalletRng,
  setWalletVusdt,
  setWalletCredits,
  setWalletCreditsLocked,
  setLastTxSig,
}: HandleGameMovedArgs) => (event: CasinoGameMovedEvent) => {
  const eventSessionId = BigInt(event.sessionId);
  const currentId = currentSessionIdRef.current ? BigInt(currentSessionIdRef.current) : null;

  if (currentId !== null && eventSessionId === currentId) {
    applySessionMeta(eventSessionId, event.moveNumber);
    const stateBlob = event.newState;

    if (gameTypeRef.current === GameType.CRAPS) {
      crapsChainRollLogRef.current = null;
    }
    if (event.logs && event.logs.length > 0) {
      if (gameTypeRef.current === GameType.CRAPS) {
        const rollLog = parseCrapsChainRollLog(event.logs);
        if (rollLog) {
          crapsChainRollLogRef.current = {
            sessionId: eventSessionId,
            roll: rollLog,
          };
        }
      }
      crapsPendingRollLogRef.current = null;
    } else if (gameTypeRef.current === GameType.CRAPS) {
      const crapsSnap = crapsPendingRollLogRef.current;
      if (crapsSnap && crapsSnap.sessionId === eventSessionId) {
        let d1 = 0;
        let d2 = 0;
        if (stateBlob.length >= 5 && (stateBlob[0] === 1 || stateBlob[0] === 2)) {
          d1 = stateBlob[3] ?? 0;
          d2 = stateBlob[4] ?? 0;
        } else if (stateBlob.length >= 4) {
          d1 = stateBlob[2] ?? 0;
          d2 = stateBlob[3] ?? 0;
        }

        if (d1 > 0 && d2 > 0) {
          crapsPendingRollLogRef.current = null;
        }
      }
    }

    parseGameState(stateBlob, gameTypeRef.current);

    if (event.playerBalances) {
      const balances = event.playerBalances;
      const showTournamentStack =
        playModeRef.current === 'FREEROLL' && balances.activeTournament != null;
      const nextChips = Number(showTournamentStack ? balances.tournamentChips : balances.chips);
      const nextShields = Number(showTournamentStack ? balances.tournamentShields : balances.shields);
      const nextDoubles = Number(showTournamentStack ? balances.tournamentDoubles : balances.doubles);

      setStats(prev => ({
        ...prev,
        chips: nextChips,
        shields: nextShields,
        doubles: nextDoubles,
      }));
      setWalletRng(Number(balances.chips));
      setWalletVusdt(Number(balances.vusdtBalance ?? 0));
      lastBalanceUpdateRef.current = Date.now();
      currentChipsRef.current = nextChips;
    } else if (clientRef.current && publicKeyBytesRef.current) {
      void (async () => {
        try {
          const now = Date.now();
          if (now - lastPlayerSyncRef.current < playerSyncMinIntervalMs) {
            return;
          }
          lastPlayerSyncRef.current = now;
          const playerState = await clientRef.current!.getCasinoPlayer(publicKeyBytesRef.current!);
          if (!playerState) return;

          const showTournamentStack =
            playModeRef.current === 'FREEROLL' && playerState.activeTournament != null;
          const nextChips = Number(showTournamentStack ? playerState.tournamentChips : playerState.chips);
          const nextShields = Number(showTournamentStack ? playerState.tournamentShields : playerState.shields);
          const nextDoubles = Number(showTournamentStack ? playerState.tournamentDoubles : playerState.doubles);

          setStats(prev => ({
            ...prev,
            chips: nextChips,
            shields: nextShields,
            doubles: nextDoubles,
          }));
          setWalletRng(Number(playerState.chips));
          setWalletVusdt(Number(playerState.vusdtBalance ?? 0));
          setWalletCredits(Number(playerState.freerollCredits ?? 0));
          setWalletCreditsLocked(Number(playerState.freerollCreditsLocked ?? 0));
          lastBalanceUpdateRef.current = Date.now();
          currentChipsRef.current = nextChips;
        } catch (e) {
          logDebug('[chainEvents] Failed to refresh player state after move:', e);
        }
      })();
    }

    const currentSuperMode = gameStateRef.current?.superMode;
    const hasActiveSuper = gameStateRef.current?.activeModifiers?.super;
    if (
      hasActiveSuper &&
      (!currentSuperMode || !currentSuperMode.isActive ||
        !currentSuperMode.multipliers || currentSuperMode.multipliers.length === 0)
    ) {
      void (async () => {
        try {
          const sessionState = await clientRef.current?.getCasinoSession(eventSessionId);
          if (
            sessionState?.superMode?.isActive &&
            Array.isArray(sessionState.superMode.multipliers) &&
            sessionState.superMode.multipliers.length > 0
          ) {
            setGameState(prev => ({ ...prev, superMode: sessionState.superMode ?? null }));
          }
        } catch (e) {
          logDebug('[chainEvents] SuperMode fallback fetch failed:', e);
        }
      })();
    }

    if (pendingMoveCountRef.current > 0) {
      pendingMoveCountRef.current = Math.max(0, pendingMoveCountRef.current - 1);
      if (pendingMoveCountRef.current === 0) {
        isPendingRef.current = false;
      } else {
        isPendingRef.current = true;
      }
    } else {
      isPendingRef.current = false;
    }

    const isBlackjackAwaitingReveal =
      gameTypeRef.current === GameType.BLACKJACK &&
      stateBlob.length >= 2 &&
      stateBlob[0] === 2 &&
      stateBlob[1] === 2;

    if (isBlackjackAwaitingReveal && !isPendingRef.current && currentSessionIdRef.current) {
      void (async () => {
        try {
          isPendingRef.current = true;
          setGameState(prev => {
            const next = { ...prev, message: 'REVEALING...' };
            gameStateRef.current = next;
            return next;
          });
          const result = await chainService.sendMove(
            currentSessionIdRef.current!,
            new Uint8Array([6])
          );
          if (result.txHash) setLastTxSig(result.txHash);
        } catch (error) {
          console.error('[chainEvents] Blackjack auto-reveal failed:', error);
          isPendingRef.current = false;
          setGameState(prev => {
            const next = { ...prev, message: 'REVEAL FAILED (SPACE)' };
            gameStateRef.current = next;
            return next;
          });
        }
      })();
    }
  }
};
