import React, { useEffect, useState, useRef } from 'react';
import { GameType } from './types';
import { useTerminalGame } from './hooks/useTerminalGame';
import { useKeyboardControls } from './hooks/useKeyboardControls';
import { PlaySwapStakeTabs } from './components/PlaySwapStakeTabs';
import { WalletPill } from './components/WalletPill';
import { AuthStatusPill } from './components/AuthStatusPill';

// Components
import {
  Header,
  Sidebar,
  Footer,
  CommandPalette,
  CustomBetOverlay,
  HelpOverlay,
  TournamentAlert,
  ResponsiblePlayOverlay,
  type ResponsiblePlaySettings,
} from './components/casino/Layout';
import { MobileChipSelector } from './components/casino/MobileChipSelector';
import { HamburgerMenu } from './components/casino/HamburgerMenu';
import { ModeSelectView, type PlayMode } from './components/casino/ModeSelectView';
import { RegistrationView } from './components/casino/RegistrationView';
import { ActiveGame } from './components/casino/ActiveGame';
import { ErrorBoundary } from './components/ErrorBoundary';
import { playSfx, setSfxEnabled } from './services/sfx';
import { track } from './services/telemetry';

// Menu
const SORTED_GAMES = Object.values(GameType).filter(g => g !== GameType.NONE).sort();

const RESPONSIBLE_PLAY_STORAGE_KEY = 'nullspace_responsible_play_v1';

const DEFAULT_RESPONSIBLE_PLAY: ResponsiblePlaySettings = {
  realityCheckMinutes: 0, // Disabled by default - users can enable in settings
  maxWager: 0,
  maxLoss: 0,
  maxSessionMinutes: 0,
  cooldownUntilMs: 0,
  sessionStartMs: 0,
  pnlBaseline: 0,
  nextRealityCheckMs: 0,
};

export default function CasinoApp() {
  // Mode selection (Cash vs Freeroll)
  const [playMode, setPlayMode] = useState<PlayMode | null>(null);

  const { stats, gameState, setGameState, deck, aiAdvice, tournamentTime, phase, leaderboard, isRegistered, walletRng, walletVusdt, walletCredits, walletCreditsLocked, walletPublicKeyHex, lastTxSig, botConfig, setBotConfig, isRegisteringOrJoining, isFaucetClaiming, freerollActiveTournamentId, freerollActiveTimeLeft, freerollActivePrizePool, freerollActivePlayerCount, playerActiveTournamentId, freerollNextStartIn, freerollNextTournamentId, freerollIsJoinedNext, tournamentsPlayedToday, tournamentDailyLimit, actions } = useTerminalGame(playMode);

  // UI State
  const [commandOpen, setCommandOpen] = useState(false);
  const [customBetOpen, setCustomBetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpDetail, setHelpDetail] = useState<string | null>(null);
  const [customBetString, setCustomBetString] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [leaderboardView, setLeaderboardView] = useState<'RANK' | 'PAYOUT'>('RANK');
  const [numberInputString, setNumberInputString] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [touchMode, setTouchMode] = useState(() => {
    try {
      return localStorage.getItem('nullspace_touch_mode') === 'true';
    } catch {
      return false;
    }
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem('nullspace_sound_enabled');
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const [reducedMotion, setReducedMotion] = useState(() => {
    try {
      const raw = localStorage.getItem('nullspace_reduced_motion');
      if (raw !== null) return raw === 'true';
    } catch {
      // ignore
    }
    try {
      return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
      return false;
    }
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const customBetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('nullspace_sound_enabled', soundEnabled ? 'true' : 'false');
    } catch {
      // ignore
    }
    setSfxEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('nullspace_reduced_motion', reducedMotion ? 'true' : 'false');
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      if (reducedMotion) document.documentElement.dataset.reducedMotion = 'true';
      else delete document.documentElement.dataset.reducedMotion;
    }
  }, [reducedMotion]);

  const [rpOpen, setRpOpen] = useState(false);
  const [rpMode, setRpMode] = useState<'settings' | 'reality'>('settings');
  const [rp, setRp] = useState<ResponsiblePlaySettings>(() => {
    try {
      const raw = localStorage.getItem(RESPONSIBLE_PLAY_STORAGE_KEY);
      if (!raw) return DEFAULT_RESPONSIBLE_PLAY;
      const parsed = JSON.parse(raw);
      // Force disable reality check - always reset to 0
      return { ...DEFAULT_RESPONSIBLE_PLAY, ...parsed, realityCheckMinutes: 0, nextRealityCheckMs: 0 };
    } catch {
      return DEFAULT_RESPONSIBLE_PLAY;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(RESPONSIBLE_PLAY_STORAGE_KEY, JSON.stringify(rp));
    } catch {
      // ignore
    }
  }, [rp]);

  useEffect(() => {
    try {
      localStorage.setItem('nullspace_touch_mode', touchMode ? 'true' : 'false');
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      if (touchMode) document.documentElement.dataset.touchMode = 'true';
      else delete document.documentElement.dataset.touchMode;
    }
  }, [touchMode]);

  const openCommandPalette = () => {
    track('ui.command_palette.opened', { surface: 'casino' });
    setHelpOpen(false);
    setHelpDetail(null);
    setCustomBetOpen(false);
    setSearchQuery('');
    setCommandOpen(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const toggleHelp = () => {
    track('ui.help.toggled', { surface: 'casino' });
    setCommandOpen(false);
    setCustomBetOpen(false);
    setHelpDetail(null);
    setHelpOpen((prev) => !prev);
  };

  const openResponsiblePlay = (mode: 'settings' | 'reality' = 'settings') => {
    setRpMode(mode);
    setRpOpen(true);
  };

  const currentPnl = stats.pnlHistory[stats.pnlHistory.length - 1] || 0;
  const sessionStartMs = rp.sessionStartMs || 0;
  const sessionMinutes = sessionStartMs > 0 ? Math.floor((Date.now() - sessionStartMs) / 60_000) : 0;
  const netPnl = sessionStartMs > 0 ? currentPnl - (rp.pnlBaseline || 0) : 0;

  const ensureSessionStarted = () => {
    if (rp.sessionStartMs) return;
    const now = Date.now();
    const baseline = stats.pnlHistory[stats.pnlHistory.length - 1] || 0;
    setRp((prev) => ({
      ...prev,
      sessionStartMs: now,
      pnlBaseline: baseline,
      nextRealityCheckMs: prev.realityCheckMinutes > 0 ? now + prev.realityCheckMinutes * 60_000 : 0,
    }));
  };

  const setCooldownMinutes = (minutes: number) => {
    const until = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
    setRp((prev) => ({ ...prev, cooldownUntilMs: until }));
  };

  const continueAfterRealityCheck = () => {
    const nextAt = rp.realityCheckMinutes > 0 ? Date.now() + rp.realityCheckMinutes * 60_000 : 0;
    setRp((prev) => ({ ...prev, nextRealityCheckMs: nextAt }));
    setRpOpen(false);
    setRpMode('settings');
  };

  const stopPlaying = () => {
    // Track session end with Super Mode metrics (Phase 2)
    if (rp.sessionStartMs > 0) {
      const durationMinutes = Math.floor((Date.now() - rp.sessionStartMs) / 60_000);
      track('casino.session.ended', {
        mode: playMode,
        durationMinutes,
        netPnl,
        finalChips: stats.chips,
        auraMeter: stats.auraMeter,
      });
    }

    setRpOpen(false);
    setRpMode('settings');
    setPlayMode(null);
    setRp((prev) => ({ ...prev, sessionStartMs: 0, pnlBaseline: 0, nextRealityCheckMs: 0 }));
  };

  const safeSetBetAmount = (amount: number) => {
    if (rp.maxWager > 0 && amount > rp.maxWager) {
      setGameState((prev) => ({ ...prev, message: `MAX BET: ${rp.maxWager}` }));
      actions.setBetAmount(rp.maxWager);
      return;
    }
    actions.setBetAmount(amount);
  };

  const safeDeal = () => {
    const now = Date.now();
    const atRoundBoundary = gameState.stage === 'BETTING' || gameState.stage === 'RESULT';
    if (atRoundBoundary) {
      ensureSessionStarted();

      const startMs = rp.sessionStartMs || now;
      const baseline = rp.sessionStartMs ? (rp.pnlBaseline || 0) : currentPnl;
      const net = currentPnl - baseline;

      const cooldownActive = rp.cooldownUntilMs > 0 && now < rp.cooldownUntilMs;
      const cooldownRemaining = cooldownActive ? Math.max(1, Math.ceil((rp.cooldownUntilMs - now) / 60_000)) : 0;
      const lossLimitHit = rp.maxLoss > 0 && net <= -rp.maxLoss;
      const sessionLimitHit =
        rp.maxSessionMinutes > 0 && now - startMs >= rp.maxSessionMinutes * 60_000;
      const realityDue =
        rp.realityCheckMinutes > 0 && rp.nextRealityCheckMs > 0 && now >= rp.nextRealityCheckMs;

      if (cooldownActive) {
        track('casino.deal.blocked', { reason: 'cooldown', remainingMinutes: cooldownRemaining, game: gameState.type, mode: playMode });
        setGameState((prev) => ({ ...prev, message: `COOLDOWN ACTIVE (${cooldownRemaining}m)` }));
        openResponsiblePlay('settings');
        return;
      }
      if (sessionLimitHit) {
        track('casino.deal.blocked', { reason: 'session_limit', game: gameState.type, mode: playMode });
        setGameState((prev) => ({ ...prev, message: 'SESSION LIMIT REACHED' }));
        openResponsiblePlay('settings');
        return;
      }
      if (lossLimitHit) {
        track('casino.deal.blocked', { reason: 'loss_limit', game: gameState.type, mode: playMode, netPnl: net });
        setGameState((prev) => ({ ...prev, message: 'LOSS LIMIT REACHED' }));
        openResponsiblePlay('settings');
        return;
      }
      if (realityDue) {
        track('casino.deal.blocked', { reason: 'reality_check', game: gameState.type, mode: playMode });
        openResponsiblePlay('reality');
        return;
      }
    }

    track('casino.deal', {
      game: gameState.type,
      mode: playMode,
      stage: gameState.stage,
      bet: gameState.bet,
      superMode: gameState.activeModifiers?.super || false,
      auraMeter: stats.auraMeter,
    });
    if (gameState.type !== GameType.CRAPS && gameState.type !== GameType.SIC_BO) {
      void playSfx('deal');
    }
    actions.deal();
  };

  const safeStartGame = (g: GameType) => {
    track('casino.game.started', { game: g, mode: playMode });
    actions.startGame(g);
  };

  const safeActions = {
    ...actions,
    startGame: safeStartGame,
    deal: safeDeal,
    setBetAmount: safeSetBetAmount,
  };

  useEffect(() => {
    if (!playMode) return;
    if (rp.realityCheckMinutes <= 0) return;
    if (rp.sessionStartMs <= 0 || rp.nextRealityCheckMs <= 0) return;
    if (rpOpen) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (rp.nextRealityCheckMs > 0 && now >= rp.nextRealityCheckMs) {
        if (gameState.stage !== 'PLAYING') {
          openResponsiblePlay('reality');
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState.stage, playMode, rp.nextRealityCheckMs, rp.realityCheckMinutes, rp.sessionStartMs, rpOpen]);

  // Keyboard
  useKeyboardControls({
      gameState,
      uiState: { commandOpen, customBetOpen, helpOpen, searchQuery, numberInputString },
      uiActions: {
          setCommandOpen, setCustomBetOpen, setHelpOpen, setHelpDetail, setSearchQuery,
          setCustomBetString, setNumberInputString,
          startGame: safeActions.startGame,
          setBetAmount: safeActions.setBetAmount
      },
      gameActions: { ...safeActions, setGameState },
      phase,
      playMode,
      isRegistered,
      inputRefs: { input: inputRef, customBet: customBetRef },
      sortedGames: SORTED_GAMES
  });

  // Ensure number input is cleared whenever a numeric-input mode opens.
  useEffect(() => {
    if (gameState.rouletteInputMode !== 'NONE' || gameState.sicBoInputMode !== 'NONE') {
      setNumberInputString('');
    }
  }, [gameState.rouletteInputMode, gameState.sicBoInputMode]);

  // Handle Enter in Inputs
  const handleCommandEnter = () => {
      const match = SORTED_GAMES.find(g => g.toLowerCase().includes(searchQuery.toLowerCase()));
      if (match) actions.startGame(match as GameType);
      setCommandOpen(false);
      setSearchQuery("");
  };
  const handleCustomBetEnter = () => {
      const val = parseInt(customBetString);
      if (!isNaN(val) && val > 0) safeActions.setBetAmount(val);
      setCustomBetOpen(false); setCustomBetString("");
  };
  const handleNumberInputEnter = () => {
      const val = parseInt(numberInputString);
      if (!isNaN(val)) {
          if (gameState.type === GameType.ROULETTE) {
              let betType: Parameters<typeof actions.placeRouletteBet>[0] | null = null;
              let valid = true;

              switch (gameState.rouletteInputMode) {
                  case 'STRAIGHT':
                      betType = 'STRAIGHT';
                      valid = val >= 0 && val <= 36;
                      break;
                  case 'SPLIT_H':
                      betType = 'SPLIT_H';
                      valid = val >= 1 && val <= 35 && val % 3 !== 0;
                      break;
                  case 'SPLIT_V':
                      betType = 'SPLIT_V';
                      valid = val >= 1 && val <= 33;
                      break;
                  case 'STREET':
                      betType = 'STREET';
                      valid = val >= 1 && val <= 34 && (val - 1) % 3 === 0;
                      break;
                  case 'CORNER':
                      betType = 'CORNER';
                      valid = val >= 1 && val <= 32 && val % 3 !== 0;
                      break;
                  case 'SIX_LINE':
                      betType = 'SIX_LINE';
                      valid = val >= 1 && val <= 31 && (val - 1) % 3 === 0;
                      break;
                  case 'NONE':
                      betType = null;
                      valid = false;
                      break;
              }

              if (betType && valid) {
                  actions.placeRouletteBet(betType, val);
              } else {
                  setGameState((prev) => ({ ...prev, message: "INVALID NUMBER" }));
              }
          }
          if (gameState.type === GameType.SIC_BO) actions.placeSicBoBet('SUM', val);
      }
      setNumberInputString("");
      setGameState((prev) => ({ ...prev, rouletteInputMode: 'NONE', sicBoInputMode: 'NONE' }));
  };

  if (playMode === null) {
      return <ModeSelectView onSelect={setPlayMode} />;
  }

	  if (playMode === 'FREEROLL' && phase === 'REGISTRATION') {
	      return (
	          <RegistrationView
	              stats={stats}
	              leaderboard={leaderboard}
	              isRegistered={isRegistered}
	              statusMessage={gameState.message}
	              lastTxSig={lastTxSig ?? undefined}
	              isSubmitting={isRegisteringOrJoining}
	              activeTournamentId={freerollActiveTournamentId}
	              playerActiveTournamentId={playerActiveTournamentId}
	              activeTimeLeft={freerollActiveTimeLeft}
	              nextStartIn={freerollNextStartIn}
	              nextTournamentId={freerollNextTournamentId}
	              isJoinedNext={freerollIsJoinedNext}
	              tournamentsPlayedToday={tournamentsPlayedToday}
	              dailyLimit={tournamentDailyLimit}
	              onRegister={actions.registerForTournament}
	              onEnterTournament={actions.enterTournament}
	              botConfig={botConfig}
	              onBotConfigChange={setBotConfig}
	          />
	      );
	  }

  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-titanium-50 text-titanium-900 font-sans overflow-hidden select-none" onKeyDown={(e) => {
        if (e.key === 'Enter') {
            if (commandOpen) handleCommandEnter();
            if (customBetOpen) handleCustomBetEnter();
            if (gameState.rouletteInputMode !== 'NONE' || gameState.sicBoInputMode === 'SUM') handleNumberInputEnter();
        }
        if (e.key.toLowerCase() === 'l' && !commandOpen && !customBetOpen) setLeaderboardView(prev => prev === 'RANK' ? 'PAYOUT' : 'RANK');
    }}>
       <a
         href="#casino-main"
         className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:border focus:border-action-primary focus:bg-white focus:px-4 focus:py-2 focus:text-xs focus:font-bold focus:text-action-primary shadow-float"
       >
         Skip to content
       </a>
       <Header
           phase={phase}
           tournamentTime={playMode === 'FREEROLL' ? tournamentTime : 0}
           stats={stats}
           lastTxSig={lastTxSig ?? undefined}
           focusMode={focusMode}
           setFocusMode={setFocusMode}
           showTimer={playMode === 'FREEROLL'}
           onToggleHelp={toggleHelp}
           touchMode={touchMode}
           onToggleTouchMode={() => setTouchMode((v) => !v)}
           soundEnabled={soundEnabled}
           onToggleSound={() => setSoundEnabled((v) => !v)}
           reducedMotion={reducedMotion}
           onToggleReducedMotion={() => setReducedMotion((v) => !v)}
           playMode={playMode}
       >
           <div className="flex lg:hidden items-center gap-2">
               <MobileChipSelector 
                   currentBet={gameState.bet} 
                   onSelectBet={safeActions.setBetAmount} 
                   fixedMode 
                   className="border-none bg-transparent"
               />
                   <HamburgerMenu
                       playMode={playMode}
                       onSetPlayMode={setPlayMode}
                       onOpenSafety={() => openResponsiblePlay('settings')}
                       onToggleHelp={toggleHelp}
                       soundEnabled={soundEnabled}
                       onToggleSound={() => setSoundEnabled((v) => !v)}
                       touchMode={touchMode}
                       onToggleTouchMode={() => setTouchMode((v) => !v)}
                       reducedMotion={reducedMotion}
                       onToggleReducedMotion={() => setReducedMotion((v) => !v)}
                       publicKeyHex={walletPublicKeyHex}
                   />
           </div>
       </Header>

       <div className="border-b border-titanium-200 bg-glass-light backdrop-blur-lg px-4 py-2.5 flex items-center gap-3">
           <button
               type="button"
               onClick={openCommandPalette}
               className="h-10 px-4 rounded-full border border-titanium-200 bg-white text-titanium-800 text-[11px] font-bold tracking-widest uppercase hover:border-titanium-400 hover:shadow-sm transition-all flex items-center justify-center w-full lg:w-auto"
           >
               Games
           </button>
           <button
               type="button"
               onClick={() => openResponsiblePlay('settings')}
               className="hidden lg:flex h-10 px-4 rounded-full border border-titanium-200 bg-white text-titanium-800 text-[11px] font-bold tracking-widest uppercase hover:border-titanium-400 hover:shadow-sm transition-all items-center justify-center"
           >
               Safety
           </button>
           <div className="hidden lg:flex flex-1 min-w-0 justify-center">
               <PlaySwapStakeTabs />
           </div>
           <div className="hidden lg:flex items-center gap-3">
               <AuthStatusPill publicKeyHex={walletPublicKeyHex} />
               <WalletPill
                 rng={walletRng}
                 vusdt={walletVusdt}
                 credits={walletCredits}
                 creditsLocked={walletCreditsLocked}
                 pubkeyHex={walletPublicKeyHex}
               />
           </div>
       </div>

	       <div className="flex flex-1 overflow-hidden relative">
	          <main
              id="casino-main"
              tabIndex={-1}
              className={`flex-1 flex flex-col relative bg-titanium-50 p-4 sm:p-6 overflow-y-auto scrollbar-hide ${gameState.type !== GameType.NONE ? 'pb-28' : ''}`}
            >
	             {gameState.type === GameType.NONE ? (
	               <div className="mb-4 lg:hidden space-y-3">
	                 <AuthStatusPill publicKeyHex={walletPublicKeyHex} className="w-full" />
	                 <WalletPill
                     rng={walletRng}
                     vusdt={walletVusdt}
                     credits={walletCredits}
                     creditsLocked={walletCreditsLocked}
                     pubkeyHex={walletPublicKeyHex}
                     className="w-full"
                   />
	               </div>
	             ) : null}
	             {playMode === 'CASH' && (
	                 <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-titanium-200 rounded-2xl bg-white px-4 py-2 shadow-soft">
	                     <div className="text-[10px] font-bold text-titanium-400 tracking-[0.2em] uppercase">
	                         Current Mode: <span className="text-action-primary">Cash Play</span>
	                     </div>
                     <div className="flex items-center gap-2">
                         <button
                             className="text-[10px] font-bold border px-3 py-1.5 rounded-full bg-white border-titanium-200 text-titanium-800 hover:border-titanium-400 transition-colors uppercase tracking-widest"
                             onClick={() => setPlayMode(null)}
                         >
                             Change
                         </button>
                         <button
                             className={`text-[10px] font-bold border px-3 py-1.5 rounded-full uppercase tracking-widest transition-all ${
                                 isFaucetClaiming
                                     ? 'bg-titanium-100 border-titanium-100 text-titanium-300 cursor-not-allowed'
                                     : 'bg-action-success text-white border-action-success shadow-sm hover:scale-105 active:scale-95'
                             }`}
                             onClick={actions.claimFaucet}
                             disabled={isFaucetClaiming}
                         >
                             {isFaucetClaiming ? 'Claiming…' : 'Daily Faucet'}
                         </button>
                     </div>
                 </div>
             )}

             <div className="relative flex flex-col flex-1 min-h-0">
               {playMode === 'FREEROLL' && <TournamentAlert tournamentTime={tournamentTime} />}
               <ErrorBoundary>
                 <ActiveGame
                    gameState={gameState}
                    deck={deck}
                    chips={stats.chips}
                    numberInput={numberInputString}
                    onToggleHold={safeActions.toggleHold}
                    aiAdvice={aiAdvice}
                    actions={{ ...safeActions, setGameState }}
                    onOpenCommandPalette={openCommandPalette}
                    reducedMotion={reducedMotion}
                    playMode={playMode}
                    currentBet={gameState.bet}
                    onBetChange={safeActions.setBetAmount}
                 />
               </ErrorBoundary>
             </div>
          </main>
          {!focusMode && (
             <Sidebar
                leaderboard={leaderboard}
                history={stats.history}
                viewMode={leaderboardView}
                currentChips={stats.chips}
                prizePool={playMode === 'FREEROLL' ? (freerollActivePrizePool ?? undefined) : undefined}
                totalPlayers={playMode === 'FREEROLL' ? (freerollActivePlayerCount ?? undefined) : undefined}
                winnersPct={0.15}
                gameType={gameState.type}
                crapsEventLog={gameState.crapsEventLog}
                resolvedBets={gameState.resolvedBets}
                resolvedBetsKey={gameState.resolvedBetsKey}
             />
          )}
       </div>

       {gameState.type !== GameType.NONE && (
           <Footer currentBet={gameState.bet} />
       )}

       {/* MODALS */}
       <CommandPalette
            isOpen={commandOpen}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortedGames={SORTED_GAMES}
            onSelectGame={(g) => {
                safeActions.startGame(g as GameType);
                setCommandOpen(false);
                setSearchQuery("");
            }}
            inputRef={inputRef}
            onClose={() => {
                setCommandOpen(false);
                setSearchQuery("");
            }}
       />

       <CustomBetOverlay
           isOpen={customBetOpen}
           betString={customBetString}
           inputRef={customBetRef}
       />

       <HelpOverlay
           isOpen={helpOpen}
           onClose={() => {
               setHelpOpen(false);
               setHelpDetail(null);
           }}
           gameType={gameState.type}
           detail={helpDetail}
       />

       <ResponsiblePlayOverlay
           isOpen={rpOpen}
           mode={rpMode}
           onClose={() => {
               if (rpMode === 'reality') continueAfterRealityCheck();
               else setRpOpen(false);
           }}
           settings={rp}
           onChange={setRp}
           summary={{ sessionMinutes, netPnl, chips: stats.chips }}
           onContinue={continueAfterRealityCheck}
           onCooldown={(minutes) => {
               setCooldownMinutes(minutes);
               setRpOpen(false);
               setRpMode('settings');
           }}
           onStop={stopPlaying}
       />
    </div>
  );
}
