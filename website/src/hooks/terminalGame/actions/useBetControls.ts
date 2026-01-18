import { useCallback } from 'react';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import { GameState, GameType, PlayerStats, TournamentPhase } from '../../../types';
import type { CasinoChainService } from '../../../services/CasinoChainService';
import { track } from '../../../services/telemetry';

type UseBetControlsArgs = {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  stats: PlayerStats;
  isOnChain: boolean;
  chainService: CasinoChainService | null;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  tournamentTime: number;
  phase: TournamentPhase;
  playMode: 'CASH' | 'FREEROLL' | null;
  setLastTxSig: (sig: string | null) => void;
};

export const useBetControls = ({
  gameState,
  setGameState,
  stats,
  isOnChain,
  chainService,
  currentSessionIdRef,
  tournamentTime,
  phase,
  playMode,
  setLastTxSig,
}: UseBetControlsArgs) => {
  const setBetAmount = useCallback((amount: number) => {
    const baseBetLocked =
      isOnChain &&
      !!currentSessionIdRef.current &&
      [GameType.BLACKJACK, GameType.THREE_CARD, GameType.ULTIMATE_HOLDEM].includes(gameState.type);
    if (baseBetLocked) {
      setGameState(prev => ({ ...prev, message: 'BET LOCKED (START NEW GAME)' }));
      return;
    }

    const isTableGame = [GameType.BACCARAT, GameType.CRAPS, GameType.ROULETTE, GameType.SIC_BO].includes(gameState.type);
    if (gameState.stage === 'PLAYING' && !isTableGame) return;

    const maxAffordable = Math.max(0, stats.chips);
    const clampedAmount = Math.min(amount, maxAffordable);

    if (clampedAmount <= 0) {
      setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
      return;
    }

    const message =
      clampedAmount !== amount ? `MAX BET: ${maxAffordable}` : `BET SIZE: ${clampedAmount}`;
    setGameState(prev => ({ ...prev, bet: clampedAmount, message }));
  }, [gameState.stage, gameState.type, stats.chips, isOnChain, currentSessionIdRef, setGameState]);

  const toggleShield = useCallback(async () => {
    const allowedInPlay = [GameType.CRAPS, GameType.ROULETTE, GameType.SIC_BO].includes(gameState.type);
    if (gameState.stage === 'PLAYING' && !allowedInPlay) return;
    if (tournamentTime < 60 && phase === 'ACTIVE') {
      setGameState(prev => ({ ...prev, message: 'LOCKED (FINAL MINUTE)' }));
      return;
    }
    if (stats.shields <= 0 && !gameState.activeModifiers.shield) {
      setGameState(prev => ({ ...prev, message: 'NO SHIELDS REMAINING' }));
      return;
    }

    const newShieldState = !gameState.activeModifiers.shield;
    setGameState(prev => ({ ...prev, activeModifiers: { ...prev.activeModifiers, shield: newShieldState } }));

    if (isOnChain && chainService) {
      try {
        const result = await chainService.toggleShield();
        if (result.txHash) setLastTxSig(result.txHash);
      } catch (error) {
        console.error('[useBetControls] Failed to toggle shield:', error);
        setGameState(prev => ({ ...prev, activeModifiers: { ...prev.activeModifiers, shield: !newShieldState } }));
      }
    }
  }, [
    gameState.type,
    gameState.stage,
    gameState.activeModifiers.shield,
    stats.shields,
    tournamentTime,
    phase,
    isOnChain,
    chainService,
    setLastTxSig,
    setGameState,
  ]);

  const toggleDouble = useCallback(async () => {
    const allowedInPlay = [GameType.CRAPS, GameType.ROULETTE, GameType.SIC_BO].includes(gameState.type);
    if (gameState.stage === 'PLAYING' && !allowedInPlay) return;
    if (tournamentTime < 60 && phase === 'ACTIVE') {
      setGameState(prev => ({ ...prev, message: 'LOCKED (FINAL MINUTE)' }));
      return;
    }
    if (stats.doubles <= 0 && !gameState.activeModifiers.double) {
      setGameState(prev => ({ ...prev, message: 'NO DOUBLES REMAINING' }));
      return;
    }

    const newDoubleState = !gameState.activeModifiers.double;
    setGameState(prev => ({ ...prev, activeModifiers: { ...prev.activeModifiers, double: newDoubleState } }));

    if (isOnChain && chainService) {
      try {
        const result = await chainService.toggleDouble();
        if (result.txHash) setLastTxSig(result.txHash);
      } catch (error) {
        console.error('[useBetControls] Failed to toggle double:', error);
        setGameState(prev => ({ ...prev, activeModifiers: { ...prev.activeModifiers, double: !newDoubleState } }));
      }
    }
  }, [
    gameState.type,
    gameState.stage,
    gameState.activeModifiers.double,
    stats.doubles,
    tournamentTime,
    phase,
    isOnChain,
    chainService,
    setLastTxSig,
    setGameState,
  ]);

  const toggleSuper = useCallback(async () => {
    if (tournamentTime < 60 && phase === 'ACTIVE') {
      setGameState(prev => ({ ...prev, message: 'LOCKED (FINAL MINUTE)' }));
      return;
    }

    const current = Boolean(gameState.activeModifiers.super);
    const next = !current;

    track('casino.super.toggled', {
      enabled: next,
      game: gameState.type,
      mode: playMode,
      auraMeter: stats.auraMeter,
    });

    setGameState(prev => ({ ...prev, activeModifiers: { ...prev.activeModifiers, super: next } }));

    if (isOnChain && chainService) {
      try {
        const result = await chainService.toggleSuper();
        if (result.txHash) setLastTxSig(result.txHash);
      } catch (error) {
        console.error('[useBetControls] Failed to toggle super:', error);
        setGameState(prev => ({ ...prev, activeModifiers: { ...prev.activeModifiers, super: current } }));
      }
    }
  }, [
    gameState.type,
    gameState.activeModifiers.super,
    stats.auraMeter,
    playMode,
    tournamentTime,
    phase,
    isOnChain,
    chainService,
    setLastTxSig,
    setGameState,
  ]);

  /**
   * LUX-013: Set bet to lastBet value (for REBET functionality)
   * Returns true if successful, false if insufficient funds or no lastBet
   */
  const setToLastBet = useCallback((): boolean => {
    const lastBet = gameState.lastBet;
    if (!lastBet || lastBet <= 0) {
      setGameState(prev => ({ ...prev, message: 'NO PREVIOUS BET' }));
      return false;
    }

    const maxAffordable = Math.max(0, stats.chips);
    if (maxAffordable <= 0) {
      setGameState(prev => ({ ...prev, message: 'INSUFFICIENT FUNDS' }));
      return false;
    }

    const clampedAmount = Math.min(lastBet, maxAffordable);
    if (clampedAmount !== lastBet) {
      setGameState(prev => ({ ...prev, bet: clampedAmount, message: `MAX BET: ${maxAffordable}` }));
    } else {
      setGameState(prev => ({ ...prev, bet: clampedAmount }));
    }
    return true;
  }, [gameState.lastBet, stats.chips, setGameState]);

  return { setBetAmount, toggleShield, toggleDouble, toggleSuper, setToLastBet };
};
