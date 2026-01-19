import { useCallback } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { GameState, GameType, PlayerStats, AutoPlayDraft, AutoPlayPlan } from '../../../types';
import type { CasinoChainService } from '../../../services/CasinoChainService';
import { GAME_TYPE_MAP, TABLE_GAMES } from '../../../services/games';
import { logDebug } from '../../../utils/logger';
import { getCasinoKeyIdForStorage } from '../../../security/keyVault';

type UseStartGameArgs = {
  gameState: GameState;
  setGameState: Dispatch<SetStateAction<GameState>>;
  setAiAdvice: Dispatch<SetStateAction<string | null>>;
  setStats: Dispatch<SetStateAction<PlayerStats>>;
  isOnChain: boolean;
  chainService: CasinoChainService | null;
  ensureChainResponsive: () => Promise<boolean>;
  clearChainResponseTimeout: () => void;
  armChainResponseTimeout: (context: string, expectedSessionId?: bigint | null) => void;
  clientRef: MutableRefObject<any>;
  publicKeyBytesRef: MutableRefObject<Uint8Array | null>;
  hasRegisteredRef: MutableRefObject<boolean | null>;
  setIsRegistered: Dispatch<SetStateAction<boolean>>;
  lastBalanceUpdateRef: MutableRefObject<number>;
  balanceUpdateCooldownMs: number;
  setCurrentSessionId: Dispatch<SetStateAction<bigint | null>>;
  currentSessionIdRef: MutableRefObject<bigint | null>;
  gameTypeRef: MutableRefObject<GameType>;
  sessionStartChipsRef: MutableRefObject<Map<bigint, number>>;
  currentChipsRef: MutableRefObject<number>;
  pendingMoveCountRef: MutableRefObject<number>;
  isPendingRef: MutableRefObject<boolean>;
  crapsPendingRollLogRef: MutableRefObject<any>;
  crapsChainRollLogRef: MutableRefObject<any>;
  autoPlayDraftRef: MutableRefObject<AutoPlayDraft | null>;
  autoPlayPlanRef: MutableRefObject<AutoPlayPlan | null>;
  uthBackendStageRef: MutableRefObject<number>;
  setLastTxSig: (sig: string | null) => void;
};

export const useStartGame = ({
  gameState,
  setGameState,
  setAiAdvice,
  setStats,
  isOnChain,
  chainService,
  ensureChainResponsive,
  clearChainResponseTimeout,
  armChainResponseTimeout,
  clientRef,
  publicKeyBytesRef,
  hasRegisteredRef,
  setIsRegistered,
  lastBalanceUpdateRef,
  balanceUpdateCooldownMs,
  setCurrentSessionId,
  currentSessionIdRef,
  gameTypeRef,
  sessionStartChipsRef,
  currentChipsRef,
  pendingMoveCountRef,
  isPendingRef,
  crapsPendingRollLogRef,
  crapsChainRollLogRef,
  autoPlayDraftRef,
  autoPlayPlanRef,
  uthBackendStageRef,
  setLastTxSig,
}: UseStartGameArgs) => {
  return useCallback(async (type: GameType) => {
    isPendingRef.current = false;
    pendingMoveCountRef.current = 0;
    crapsPendingRollLogRef.current = null;
    crapsChainRollLogRef.current = null;
    autoPlayPlanRef.current = null;
    if (type === GameType.ULTIMATE_HOLDEM) {
      uthBackendStageRef.current = 0;
    }
    console.error('[qa-start] autoPlayDraftRef check - draft:', autoPlayDraftRef.current ? `type=${autoPlayDraftRef.current.type}` : 'null', 'startType:', type);
    if (autoPlayDraftRef.current && autoPlayDraftRef.current.type !== type) {
      console.error('[qa-start] Clearing autoPlayDraftRef due to type mismatch');
      autoPlayDraftRef.current = null;
    }

    const isTableGame = TABLE_GAMES.includes(type);

    setGameState(prev => ({
      ...prev,
      type,
      message: 'STARTING GAME...',
      bet: prev.bet,
      stage: 'BETTING',
      playerCards: [],
      dealerCards: [],
      communityCards: [],
      dice: [],
      crapsPoint: null,
      crapsEpochPointEstablished: false,
      crapsMadePointsMask: type === GameType.CRAPS ? prev.crapsMadePointsMask : 0,
      crapsBets: type === GameType.CRAPS ? prev.crapsBets : [],
      crapsUndoStack: type === GameType.CRAPS ? prev.crapsUndoStack : [],
      crapsInputMode: 'NONE',
      crapsRollHistory: type === GameType.CRAPS ? prev.crapsRollHistory : [],
      crapsEventLog: type === GameType.CRAPS ? prev.crapsEventLog : [],
      crapsLastRoundBets: prev.crapsLastRoundBets,
      rouletteBets: type === GameType.ROULETTE ? prev.rouletteBets : [],
      rouletteUndoStack: type === GameType.ROULETTE ? prev.rouletteUndoStack : [],
      rouletteLastRoundBets: prev.rouletteLastRoundBets,
      rouletteHistory: prev.rouletteHistory,
      rouletteInputMode: 'NONE',
      rouletteZeroRule: prev.rouletteZeroRule,
      rouletteIsPrison: false,
      sicBoBets: type === GameType.SIC_BO ? prev.sicBoBets : [],
      sicBoHistory: prev.sicBoHistory,
      sicBoInputMode: 'NONE',
      sicBoUndoStack: type === GameType.SIC_BO ? prev.sicBoUndoStack : [],
      sicBoLastRoundBets: prev.sicBoLastRoundBets,
      resolvedBets: [],
      resolvedBetsKey: 0,
      baccaratBets: type === GameType.BACCARAT ? prev.baccaratBets : [],
      baccaratUndoStack: type === GameType.BACCARAT ? prev.baccaratUndoStack : [],
      baccaratLastRoundBets: prev.baccaratLastRoundBets,
      lastResult: 0,
      activeModifiers: { shield: false, double: false, super: prev.activeModifiers.super },
      baccaratSelection: prev.baccaratSelection,
      insuranceBet: 0,
      blackjackStack: [],
      completedHands: [],
      blackjack21Plus3Bet: type === GameType.BLACKJACK ? prev.blackjack21Plus3Bet : 0,
      blackjackLuckyLadiesBet: type === GameType.BLACKJACK ? prev.blackjackLuckyLadiesBet : 0,
      blackjackPerfectPairsBet: type === GameType.BLACKJACK ? prev.blackjackPerfectPairsBet : 0,
      blackjackBustItBet: type === GameType.BLACKJACK ? prev.blackjackBustItBet : 0,
      blackjackRoyalMatchBet: type === GameType.BLACKJACK ? prev.blackjackRoyalMatchBet : 0,
      threeCardPairPlusBet: type === GameType.THREE_CARD ? prev.threeCardPairPlusBet : 0,
      threeCardSixCardBonusBet: type === GameType.THREE_CARD ? prev.threeCardSixCardBonusBet : 0,
      threeCardProgressiveBet: type === GameType.THREE_CARD ? prev.threeCardProgressiveBet : 0,
      threeCardProgressiveJackpot: prev.threeCardProgressiveJackpot,
      uthTripsBet: type === GameType.ULTIMATE_HOLDEM ? prev.uthTripsBet : 0,
      uthSixCardBonusBet: type === GameType.ULTIMATE_HOLDEM ? prev.uthSixCardBonusBet : 0,
      uthProgressiveBet: type === GameType.ULTIMATE_HOLDEM ? prev.uthProgressiveBet : 0,
      uthProgressiveJackpot: prev.uthProgressiveJackpot,
      uthBonusCards: [],
      casinoWarTieBet: type === GameType.CASINO_WAR ? prev.casinoWarTieBet : 0,
      hiloAccumulator: 0,
      hiloGraphData: [],
      sessionId: null,
      moveNumber: 0,
      sessionWager: isTableGame && prev.type === type ? prev.sessionWager : 0,
      sessionInterimPayout: 0,
      superMode: null,
    }));
    setAiAdvice(null);

    if (isOnChain && chainService) {
      try {
        // Mark as pending immediately to prevent fallback poll from clearing the session
        isPendingRef.current = true;

        const chainOk = await ensureChainResponsive();
        if (!chainOk) {
          clearChainResponseTimeout();
          setGameState(prev => ({
            ...prev,
            stage: 'BETTING',
            message: 'CHAIN OFFLINE - CHECK BACKEND',
          }));
          return;
        }

        let playerExistsOnChain = false;
        try {
          if (!clientRef.current) {
            console.warn('[useStartGame] clientRef.current is null, cannot check on-chain state');
          } else if (!publicKeyBytesRef.current) {
            console.warn('[useStartGame] publicKeyBytesRef.current is null, cannot check on-chain state');
          } else {
            const existingPlayer = await clientRef.current.getCasinoPlayer(publicKeyBytesRef.current);
            if (existingPlayer) {
              playerExistsOnChain = true;
              hasRegisteredRef.current = true;
              const keyId = getCasinoKeyIdForStorage();
              if (keyId) {
                localStorage.setItem(`casino_registered_${keyId}`, 'true');
              }
              setIsRegistered(true);

              const timeSinceLastUpdate = Date.now() - lastBalanceUpdateRef.current;
              const shouldUpdateBalance = timeSinceLastUpdate > balanceUpdateCooldownMs;

              setStats(prev => ({
                ...prev,
                chips: shouldUpdateBalance ? existingPlayer.chips : prev.chips,
                shields: existingPlayer.shields,
                doubles: existingPlayer.doubles,
                auraMeter: existingPlayer.auraMeter ?? prev.auraMeter ?? 0,
              }));
            } else {
              const account = await clientRef.current.getAccount(publicKeyBytesRef.current).catch(() => null);
              const accountNonce = Number(account?.nonce ?? 0);
              const accountHasHistory = Number.isFinite(accountNonce) && accountNonce > 0;

              if (accountHasHistory) {
                playerExistsOnChain = true;
                hasRegisteredRef.current = true;
                const keyId = getCasinoKeyIdForStorage();
                if (keyId) {
                  localStorage.setItem(`casino_registered_${keyId}`, 'true');
                }
                setIsRegistered(true);
                logDebug('[useStartGame] Account exists but player missing; treating as registered');
              } else {
                hasRegisteredRef.current = false;
                const keyId = getCasinoKeyIdForStorage();
                if (keyId) {
                  localStorage.removeItem(`casino_registered_${keyId}`);
                }
              }
            }
          }
        } catch (e) {
          console.error('[useStartGame] Error checking player on-chain:', e);
          hasRegisteredRef.current = false;
        }

        if (!playerExistsOnChain) {
          const playerName = `Player_${Date.now().toString(36)}`;
          let registered = false;
          let lastError: unknown = null;

          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await chainService.register(playerName);
              registered = true;
              break;
            } catch (error) {
              lastError = error;
              const message = (error as any)?.message ?? String(error);
              const lowerMessage = message.toLowerCase();

              if (lowerMessage.includes('already registered')) {
                logDebug('[useStartGame] Register rejected as already registered; continuing');
                registered = true;
                break;
              }

              if (lowerMessage.includes('nonce')) {
                try {
                  await chainService.forceSyncNonce();
                } catch {
                  // ignore sync errors
                }
                continue;
              }

              throw error;
            }
          }

          if (!registered) {
            throw lastError ?? new Error('Register failed');
          }

          hasRegisteredRef.current = true;
          const keyId = getCasinoKeyIdForStorage();
          if (keyId) {
            localStorage.setItem(`casino_registered_${keyId}`, 'true');
          }
          setIsRegistered(true);

          const maxAttempts = 10;
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
              const playerState = await clientRef.current?.getCasinoPlayer(publicKeyBytesRef.current!);
              if (playerState) {
                const timeSinceLastUpdate = Date.now() - lastBalanceUpdateRef.current;
                const shouldUpdateBalance = timeSinceLastUpdate > balanceUpdateCooldownMs;
                setStats(prev => ({
                  ...prev,
                  chips: shouldUpdateBalance ? playerState.chips : prev.chips,
                  shields: playerState.shields,
                  doubles: playerState.doubles,
                  auraMeter: playerState.auraMeter ?? prev.auraMeter ?? 0,
                }));
                break;
              }
            } catch {
              // ignore
            }
          }
        }

        const chainGameType = GAME_TYPE_MAP[type];
        const sessionId = chainService.generateNextSessionId();
        console.error('[qa-start] Setting currentSessionIdRef to:', sessionId.toString());
        currentSessionIdRef.current = sessionId;
        gameTypeRef.current = type;
        setCurrentSessionId(sessionId);
        sessionStartChipsRef.current.set(sessionId, currentChipsRef.current);
        setGameState(prev => ({
          ...prev,
          sessionId: Number(sessionId),
          moveNumber: 0,
        }));

        const autoDraft = autoPlayDraftRef.current;
        console.error('[qa-start] Converting draft to plan - autoDraft:', autoDraft ? `type=${autoDraft.type}` : 'null', 'type:', type, 'sessionId:', sessionId.toString());
        if (autoDraft && autoDraft.type === type) {
          autoPlayPlanRef.current = { ...autoDraft, sessionId };
          console.error('[qa-start] Plan created:', autoPlayPlanRef.current ? `type=${autoPlayPlanRef.current.type}` : 'null');
          autoPlayDraftRef.current = null;
        } else {
          console.error('[qa-start] No plan created - autoDraft was null or type mismatch');
        }

        const initialBetAmount = isTableGame ? 0n : BigInt(gameState.bet);
        const result = await chainService.startGameWithSessionId(chainGameType, initialBetAmount, sessionId);
        if (result.txHash) setLastTxSig(result.txHash);

        setGameState(prev => ({
          ...prev,
          message: 'WAITING FOR CHAIN...',
          sessionWager: isTableGame
            ? prev.sessionWager
            : type === GameType.ULTIMATE_HOLDEM
              ? Number(initialBetAmount) * 2
              : Number(initialBetAmount)
        }));
        armChainResponseTimeout('START GAME', sessionId);
      } catch (error) {
        console.error('[useStartGame] Failed to start game on-chain:', error);
        clearChainResponseTimeout();

        if (currentSessionIdRef.current) {
          sessionStartChipsRef.current.delete(currentSessionIdRef.current);
        }
        currentSessionIdRef.current = null;
        gameTypeRef.current = GameType.NONE;
        setCurrentSessionId(null);
        autoPlayPlanRef.current = null;
        autoPlayDraftRef.current = null;

        setGameState(prev => ({
          ...prev,
          stage: 'BETTING',
          message: `TRANSACTION FAILED - ${error?.message ?? 'TRY AGAIN'}`,
        }));
      }
    } else {
      setGameState(prev => ({
        ...prev,
        message: 'PLACE BETS & DEAL',
        stage: 'BETTING',
      }));
    }
  }, [
    armChainResponseTimeout,
    autoPlayDraftRef,
    autoPlayPlanRef,
    chainService,
    clearChainResponseTimeout,
    clientRef,
    currentChipsRef,
    currentSessionIdRef,
    ensureChainResponsive,
    gameState.bet,
    gameState.type,
    gameTypeRef,
    hasRegisteredRef,
    isOnChain,
    isPendingRef,
    pendingMoveCountRef,
    publicKeyBytesRef,
    setAiAdvice,
    setCurrentSessionId,
    setGameState,
    setIsRegistered,
    setLastTxSig,
    setStats,
    sessionStartChipsRef,
    balanceUpdateCooldownMs,
    lastBalanceUpdateRef,
    uthBackendStageRef,
  ]);
};
