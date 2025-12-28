
import React from 'react';
import { NavLink } from 'react-router-dom';
import { LeaderboardEntry, PlayerStats, GameType, CrapsEventLog, ResolvedBet } from '../../types';
import { formatTime, HELP_CONTENT, buildHistoryEntry, formatSummaryLine, prependPnlLine, formatPnlLabel } from '../../utils/gameUtils';
import { MobileDrawer } from './MobileDrawer';

interface HeaderProps {
    phase: string;
    tournamentTime: number;
    stats: PlayerStats;
    lastTxSig?: string;
    focusMode: boolean;
    setFocusMode: (mode: boolean) => void;
    showTimer?: boolean;
    onToggleHelp?: () => void;
    touchMode?: boolean;
    onToggleTouchMode?: () => void;
    soundEnabled?: boolean;
    onToggleSound?: () => void;
    reducedMotion?: boolean;
    onToggleReducedMotion?: () => void;
    playMode?: 'CASH' | 'FREEROLL' | null;
    children?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
    phase,
    tournamentTime,
    stats,
    lastTxSig,
    focusMode,
    setFocusMode,
    showTimer = true,
    onToggleHelp,
    touchMode = false,
    onToggleTouchMode,
    soundEnabled = true,
    onToggleSound,
    reducedMotion = false,
    onToggleReducedMotion,
    playMode,
    children,
}) => (
    <header className="h-14 border-b border-titanium-200 flex items-center justify-between px-4 sm:px-6 z-10 bg-glass-light backdrop-blur-xl sticky top-0">
    <div className="flex items-center gap-4 sm:gap-8">
        <span className="font-bold tracking-tight text-titanium-900 text-lg">nullspace</span>
        <div className="hidden lg:flex items-center gap-3">
            <button 
                onClick={() => setFocusMode(!focusMode)}
                className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-all duration-200 border ${
                    focusMode 
                        ? 'bg-titanium-900 text-white border-titanium-900 shadow-sm' 
                        : 'text-titanium-800 bg-white border-titanium-200 hover:border-titanium-400'
                }`}
            >
                {focusMode ? 'Focus On' : 'Focus'}
            </button>
            {onToggleSound ? (
                <button
                    type="button"
                    onClick={onToggleSound}
                    className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-all duration-200 border ${
                        soundEnabled 
                            ? 'bg-white text-titanium-800 border-titanium-200 hover:border-titanium-400' 
                            : 'bg-titanium-100 text-titanium-400 border-titanium-100'
                    }`}
                >
                    {soundEnabled ? 'Sound' : 'Muted'}
                </button>
            ) : null}
            <NavLink
                to="/security"
                className="text-[11px] font-semibold px-3 py-1 rounded-full transition-all duration-200 border text-titanium-800 bg-white border-titanium-200 hover:border-titanium-400"
            >
                Security
            </NavLink>
            {onToggleHelp && (
                <button
                    type="button"
                    onClick={onToggleHelp}
                    className="text-[11px] font-semibold px-3 py-1 rounded-full transition-all duration-200 border text-titanium-800 bg-white border-titanium-200 hover:border-titanium-400"
                >
                    Help
                </button>
            )}
        </div>
    </div>
    <div className="flex items-center gap-4 sm:gap-6 text-sm">
            {showTimer && (
                <div className="flex items-center gap-2 px-3 py-1 bg-titanium-100 rounded-full border border-titanium-200">
                    <span className="text-titanium-400 text-[10px] font-bold tracking-widest uppercase">Timer</span>
                    <span className={`font-mono font-bold tabular-nums ${tournamentTime < 60 ? 'text-action-destructive animate-pulse' : 'text-titanium-900'}`}>{formatTime(tournamentTime)}</span>
                </div>
            )}
            
            {playMode !== 'CASH' && (
                <div className="hidden md:flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-titanium-400 text-[10px] font-bold tracking-widest uppercase">Shields</span>
                        <div className="flex gap-1.5">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i < stats.shields ? 'bg-action-primary shadow-sm' : 'bg-titanium-200'}`} />
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-titanium-400 text-[10px] font-bold tracking-widest uppercase">Aura</span>
                        <div className="flex gap-1 items-center h-3">
                            {[...Array(5)].map((_, i) => (
                                <div
                                    key={i}
                                    className={`w-1.5 h-full rounded-full transition-all duration-300 ${
                                        i < (stats.auraMeter ?? 0)
                                            ? 'bg-action-success'
                                            : 'bg-titanium-200'
                                    }`}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                    <span className="text-titanium-400 text-[9px] font-bold tracking-widest uppercase leading-none mb-0.5">Balance</span>
                    <span className="text-titanium-900 font-bold text-base sm:text-lg tracking-tight tabular-nums leading-none">
                        ${stats.chips.toLocaleString()}
                    </span>
                </div>
            </div>
            {children}
    </div>
    </header>
);;

export const TournamentAlert: React.FC<{ tournamentTime: number }> = ({ tournamentTime }) => {
    if (tournamentTime === 60 || tournamentTime === 59 || tournamentTime === 58) {
        return (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-action-destructive text-white px-6 py-2 rounded-full font-bold text-xs tracking-widest uppercase shadow-lg z-50 animate-bounce">
                One minute remaining
            </div>
        );
    }
    if (tournamentTime === 30 || tournamentTime === 29 || tournamentTime === 28) {
        return (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-action-destructive text-white px-6 py-2 rounded-full font-bold text-xs tracking-widest uppercase shadow-lg z-50 animate-bounce">
                30 seconds left
            </div>
        );
    }
    if (tournamentTime <= 5 && tournamentTime > 0) {
        return (
             <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none bg-white/20 backdrop-blur-sm">
                 <div className="text-[12rem] font-light text-action-destructive opacity-80 animate-scale-in tabular-nums">
                     {tournamentTime}
                 </div>
             </div>
        );
    }
    return null;
};

export const Sidebar: React.FC<SidebarProps> = ({ leaderboard, history, viewMode = 'RANK', currentChips, prizePool, totalPlayers, winnersPct = 0.15, gameType, crapsEventLog = [], resolvedBets = [], resolvedBetsKey = 0 }) => {
    const effectivePlayerCount = totalPlayers ?? leaderboard.length;
    const bubbleIndex = Math.max(1, Math.min(effectivePlayerCount, Math.ceil(effectivePlayerCount * winnersPct)));
    const userEntry = leaderboard.find(e => e.name === 'YOU' || e.name.includes('(YOU)'));
    const isCraps = gameType === GameType.CRAPS;
    const resolvedEntries = resolvedBets.filter((bet) => bet && bet.label);

    const getPayout = (rank: number) => {
        if (!prizePool || effectivePlayerCount <= 0) return "$0";
        if (rank > bubbleIndex) return "$0";
        let totalWeight = 0;
        for (let i = 1; i <= bubbleIndex; i++) totalWeight += 1 / i;
        const payout = Math.floor(((1 / rank) / totalWeight) * prizePool);
        return `$${payout.toLocaleString()}`;
    };

    const renderEntry = (entry: LeaderboardEntry, i: number, isSticky = false) => {
        let rank = i + 1;
        if (isSticky) {
            rank = leaderboard.findIndex(e => e.name === entry.name) + 1;
        }
        const isUser = entry.name === 'YOU' || entry.name.includes('(YOU)');
        const isMoneyCutoff = rank === bubbleIndex;
        const displayChips = isUser && currentChips !== undefined ? currentChips : entry.chips;

        return (
            <React.Fragment key={isSticky ? 'sticky-you' : i}>
                <div className={`flex justify-between items-center py-2 px-3 rounded-xl transition-colors ${
                    isSticky 
                        ? 'bg-titanium-900 text-white shadow-lg' 
                        : isUser ? 'bg-titanium-100 text-titanium-900' : 'text-titanium-800'
                }`}>
                    <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold font-mono w-4 text-center ${isSticky ? 'text-titanium-400' : 'text-titanium-300'}`}>{rank}</span>
                        <span className={`text-sm font-medium ${isSticky ? 'text-white' : 'text-titanium-800'}`}>{entry.name}</span>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${
                        isSticky ? 'text-white' : 
                        viewMode === 'PAYOUT' && rank <= bubbleIndex ? 'text-action-success' : 'text-titanium-900'
                    }`}>
                        {viewMode === 'RANK' ? `$${Math.floor(displayChips).toLocaleString()}` : getPayout(rank)}
                    </span>
                </div>
                {!isSticky && isMoneyCutoff && (
                    <div className="border-b border-titanium-200 my-3 relative h-px">
                        <span className="absolute left-1/2 -top-2 -translate-x-1/2 bg-white px-2 text-[9px] font-bold text-titanium-400 tracking-widest uppercase">
                            Money Line
                        </span>
                    </div>
                )}
            </React.Fragment>
        );
    };

    const renderLogEntry = (entry: string, key: number) => {
        const lines = entry.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return null;

        const pnlIndex = lines.findIndex((line, idx) => idx > 0 && /^[+-]\$/.test(line));
        const pnlLine = pnlIndex > 0 ? lines[pnlIndex] : null;
        const pnlClass = pnlLine?.startsWith('+$') ? 'text-action-success' : 'text-action-destructive';
        const detailLines = lines.slice(1).filter((_, idx) => (pnlIndex < 0 ? true : idx + 1 !== pnlIndex));

        return (
            <div key={key} className="flex flex-col gap-1 py-2 border-b border-titanium-100 last:border-0">
                <div className="text-xs font-semibold text-titanium-800 leading-tight">{lines[0]}</div>
                {pnlLine && (
                    <div className={`${pnlClass} text-xs font-bold tabular-nums`}>
                        {pnlLine}
                    </div>
                )}
                {detailLines.map((line, i) => (
                    <div key={i} className="text-[10px] text-titanium-400 leading-snug">
                        {line}
                    </div>
                ))}
            </div>
        );
    };

    const renderResolvedBet = (bet: ResolvedBet, idx: number) => {
        const isWin = bet.pnl > 0;
        const isLoss = bet.pnl < 0;
        const pnlText = formatPnlLabel(bet.pnl) || 'PUSH';
        const pnlClass = isWin ? 'text-action-success' : isLoss ? 'text-action-destructive' : 'text-titanium-400';

        return (
            <div
                key={`${resolvedBetsKey}-${bet.id}-${idx}`}
                className="bg-white border border-titanium-200 rounded-xl px-3 py-2 flex items-center justify-between shadow-soft"
            >
                <span className="text-[11px] font-bold text-titanium-800 uppercase tracking-tight truncate mr-2">{bet.label}</span>
                <span className={`text-[11px] font-bold tabular-nums ${pnlClass}`}>{pnlText}</span>
            </div>
        );
    };

    return (
        <aside className="w-72 border-l border-titanium-200 bg-white hidden lg:flex flex-col">
            {/* Live Feed Header */}
            <div className="px-6 pt-6 pb-4 flex-none">
                <div className="flex justify-between items-center">
                    <h3 className="text-[10px] font-bold text-titanium-400 tracking-widest uppercase">{viewMode === 'RANK' ? 'Live Feed' : 'Payouts'}</h3>
                    <button onClick={() => {}} className="text-[9px] font-bold text-titanium-400 bg-titanium-100 px-2 py-0.5 rounded-full hover:bg-titanium-200 transition-colors">
                        Toggle [L]
                    </button>
                </div>
            </div>

            {/* Fixed User Row */}
            {userEntry && (
                <div className="flex-none px-4 pb-4">
                     {renderEntry(userEntry, 0, true)}
                </div>
            )}

            {/* Scrollable Leaderboard */}
            <div className="overflow-y-auto px-4 space-y-1.5 flex-1 min-h-0">
                {leaderboard.map((entry, i) => renderEntry(entry, i, false))}
            </div>

            {resolvedEntries.length > 0 && (
                <div className="flex-none p-4 bg-titanium-50 border-t border-titanium-200">
                    <div className="text-[9px] font-bold text-titanium-400 uppercase tracking-widest mb-3 text-center">
                        Last Resolved
                    </div>
                    <div className="flex flex-col gap-2">
                        {resolvedEntries.slice(0, 5).map((bet, i) => renderResolvedBet(bet, i))}
                    </div>
                </div>
            )}

            {/* Logs Area */}
            <div className="flex-1 border-t border-titanium-200 p-6 bg-white flex flex-col min-h-0">
                <h3 className="text-[10px] font-bold text-titanium-400 uppercase tracking-widest mb-4 flex-none">
                    {isCraps ? 'Roll Log' : 'History'}
                </h3>
                <div className="flex-1 overflow-y-auto flex flex-col scrollbar-hide min-h-0">
                    {isCraps ? (
                        crapsEventLog.length === 0 ? (
                            <div className="text-titanium-300 text-xs italic">No rolls recorded.</div>
                        ) : (
                            [...crapsEventLog].reverse().slice(0, 20).map((event, i) => {
                                const diceLabel = event.dice?.length === 2 ? ` (${event.dice.join('-')})` : '';
                                const entry = buildHistoryEntry(formatSummaryLine(`Roll: ${event.total}${diceLabel}`), prependPnlLine([], event.pnl));
                                return renderLogEntry(entry, i);
                            })
                        )
                    ) : (
                        history.slice(-15).reverse().map((log, i) => renderLogEntry(log, i))
                    )}
                </div>
            </div>
        </aside>
    );
};

export const Footer: React.FC<{ currentBet?: number }> = ({ currentBet }) => {
    const bets = [1, 5, 25, 100, 500, 1000, 5000, 10000, 50000];
    const isCustom = currentBet && !bets.includes(currentBet);

    return (
        <footer className="hidden lg:flex fixed bottom-0 left-0 right-0 lg:right-72 border-t border-titanium-200 bg-glass-light backdrop-blur-xl h-10 items-center justify-center gap-6 px-6 z-20">
            <span className="text-[9px] font-bold text-titanium-400 tracking-widest uppercase mr-2">Quick Bet Keys</span>
            {bets.map((bet, i) => {
                const label = bet >= 1000 ? `${bet/1000}k` : `$${bet}`;
                const isSelected = currentBet === bet;
                return (
                    <div key={i} className="flex items-center gap-1.5">
                        <span className="text-titanium-300 text-[10px] font-mono">^{i + 1}</span>
                        <span className={`text-[11px] font-bold tabular-nums transition-colors ${isSelected ? 'text-action-primary' : 'text-titanium-800'}`}>
                            {label}
                        </span>
                    </div>
                );
            })}
            <div className="flex items-center gap-1.5 ml-4">
                <span className="text-titanium-300 text-[10px] font-mono">^0</span>
                <span className={`text-[11px] font-bold transition-colors ${isCustom ? 'text-action-primary' : 'text-titanium-800'}`}>Custom</span>
            </div>
        </footer>
    );
};

interface CommandPaletteProps {
    isOpen: boolean;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    sortedGames: string[];
    onSelectGame: (g: string) => void;
    inputRef: React.RefObject<HTMLInputElement>;
    onClose?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, searchQuery, onSearchChange, sortedGames, onSelectGame, inputRef, onClose }) => {
    if (!isOpen) return null;
    const filtered = sortedGames.filter(g => g.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
        <div
            className="fixed inset-0 bg-titanium-900/40 backdrop-blur-md z-[100] flex items-start justify-center pt-24 px-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-[640px] bg-white rounded-3xl shadow-float overflow-hidden flex flex-col border border-titanium-200 max-h-[60vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 py-5 border-b border-titanium-100 flex items-center gap-4">
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="flex-1 bg-transparent outline-none text-titanium-900 placeholder-titanium-300 font-medium text-lg"
                        placeholder="Search games..."
                        autoFocus
                    />
                    <div className="text-[10px] font-bold text-titanium-400 bg-titanium-100 px-2 py-1 rounded-md uppercase tracking-widest">Esc to close</div>
                </div>
                <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
                    {filtered.map((game, i) => (
                        <div
                            key={game}
                            onClick={() => onSelectGame(game)}
                            className="flex items-center justify-between px-6 py-3.5 hover:bg-titanium-50 cursor-pointer group transition-colors"
                        >
                            <span className="text-titanium-800 font-semibold text-base group-hover:text-action-primary">{game}</span>
                            <span className="text-titanium-300 font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                                Enter to play
                            </span>
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div className="px-6 py-8 text-titanium-400 text-center italic font-medium">No games match your search.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const CustomBetOverlay: React.FC<{ isOpen: boolean; betString: string; inputRef: React.RefObject<HTMLInputElement> }> = ({ isOpen, betString, inputRef }) => {
    if (!isOpen) return null;

    return (
         <div className="fixed inset-0 bg-titanium-900/60 backdrop-blur-lg z-[100] flex items-center justify-center px-4">
             <div className="bg-white rounded-[40px] p-10 shadow-float flex flex-col items-center gap-6 w-full max-w-sm border border-titanium-200">
                 <div className="text-[10px] font-bold tracking-[0.2em] text-titanium-400 uppercase">Set Custom Bet</div>
                 <div className="flex items-center text-6xl text-titanium-900 font-bold tracking-tighter">
                     <span className="text-titanium-200">$</span>
                     <input
                        ref={inputRef}
                        type="text"
                        value={betString}
                        readOnly
                        className="bg-transparent outline-none text-center w-full"
                     />
                 </div>
                 <div className="flex flex-col gap-3 w-full">
                    <div className="h-1 bg-titanium-100 rounded-full w-full overflow-hidden">
                        <div className="h-full bg-action-primary w-1/3 animate-pulse" />
                    </div>
                    <div className="text-[10px] font-medium text-titanium-400 text-center uppercase tracking-widest mt-2">
                        Use number keys to type
                    </div>
                 </div>
             </div>
         </div>
    );
};

interface HelpOverlayProps { 
    isOpen: boolean; 
    onClose: () => void; 
    gameType: GameType; 
    detail?: string | null; 
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({ isOpen, onClose, gameType, detail }) => {
    if (!isOpen) return null;
    
    const renderHelpDetail = (detailKey: string) => {
        const gameHelp = HELP_CONTENT[gameType];
        const detailInfo = gameHelp ? gameHelp[detailKey] : null;
        if (!detailInfo) return null;

        return (
            <div className="fixed inset-0 bg-titanium-900/40 backdrop-blur-md z-[110] flex items-center justify-center p-6">
                <div className="bg-white rounded-3xl shadow-float max-w-md w-full flex flex-col border border-titanium-200 overflow-hidden">
                    <div className="p-8 border-b border-titanium-100 bg-titanium-50">
                         <div className="text-[10px] font-bold text-action-primary mb-3 uppercase tracking-[0.2em]">Rule Detail</div>
                         <h2 className="text-2xl font-bold text-titanium-900 tracking-tight">{detailInfo.title}</h2>
                    </div>
                    <div className="p-8 space-y-8">
                        <div>
                            <h4 className="text-action-success font-bold text-[10px] uppercase tracking-widest mb-2">Win</h4>
                            <p className="text-sm text-titanium-800 font-medium leading-relaxed">{detailInfo.win}</p>
                        </div>
                        <div>
                            <h4 className="text-action-destructive font-bold text-[10px] uppercase tracking-widest mb-2">Loss</h4>
                            <p className="text-sm text-titanium-800 font-medium leading-relaxed">{detailInfo.loss}</p>
                        </div>
                        <div className="bg-titanium-50 p-4 rounded-2xl border border-titanium-100">
                            <h4 className="text-titanium-400 font-bold text-[10px] uppercase tracking-widest mb-2">Example</h4>
                            <p className="text-xs text-titanium-600 font-mono leading-relaxed">{detailInfo.example}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-4 text-center text-xs font-bold text-titanium-400 uppercase tracking-widest border-t border-titanium-100 hover:bg-titanium-50 transition-colors">
                        Close
                    </button>
                </div>
            </div>
        );
    };

    if (detail) return renderHelpDetail(detail);

    const renderGridItems = (items: {key: string, label: string}[]) => (
        <div className="grid grid-cols-2 gap-4">
            {items.map(item => (
                <div key={item.key} className="flex items-center gap-3">
                    <span className="w-8 h-8 flex items-center justify-center bg-titanium-900 text-white rounded-lg font-bold text-xs shadow-sm">{item.key}</span>
                    <span className="text-sm font-semibold text-titanium-800 uppercase tracking-tight">{item.label}</span>
                </div>
            ))}
        </div>
    );

    const getContent = () => {
        switch(gameType) {
            case GameType.BLACKJACK:
                return renderGridItems([
                    {key: 'H', label: 'Hit'}, {key: 'S', label: 'Stand'},
                    {key: 'D', label: 'Double'}, {key: 'P', label: 'Split'},
                    {key: 'I', label: 'Insure'}
                ]);
            case GameType.ROULETTE:
                return renderGridItems([
                    {key: 'R', label: 'Red'}, {key: 'B', label: 'Black'},
                    {key: 'E', label: 'Even'}, {key: 'O', label: 'Odd'},
                    {key: 'SPACE', label: 'Spin'}
                ]);
            default:
                return <div className="text-titanium-400 font-medium text-sm">Standard controls: [SPACE] to action.</div>;
        }
    };

    return (
        <div className="fixed inset-0 bg-titanium-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6" onClick={onClose}>
            <div className="bg-white rounded-[32px] shadow-float max-w-2xl w-full flex flex-col border border-titanium-200 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-8 border-b border-titanium-100 flex justify-between items-center bg-titanium-50">
                    <div>
                        <h2 className="text-2xl font-bold text-titanium-900 tracking-tight">Rules & Controls</h2>
                        <p className="text-xs text-titanium-400 font-semibold mt-1 uppercase tracking-widest">Keyboard shortcuts for power play</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-white rounded-full border border-titanium-200 text-titanium-400 hover:text-titanium-900 transition-colors">
                        ✕
                    </button>
                </div>

                <div className="p-8 overflow-y-auto space-y-10">
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-titanium-400 uppercase tracking-[0.2em] border-b border-titanium-100 pb-2">Global Controls</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                            <div className="flex items-center gap-3">
                                <span className="bg-titanium-100 text-titanium-900 px-2 py-1 rounded-md font-bold text-xs uppercase shadow-inner-light">/</span>
                                <span className="text-xs font-bold text-titanium-800 uppercase tracking-tight">Menu</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="bg-titanium-100 text-titanium-900 px-2 py-1 rounded-md font-bold text-xs uppercase shadow-inner-light">?</span>
                                <span className="text-xs font-bold text-titanium-800 uppercase tracking-tight">Help</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="bg-titanium-100 text-titanium-900 px-2 py-1 rounded-md font-bold text-xs uppercase shadow-inner-light">L</span>
                                <span className="text-xs font-bold text-titanium-800 uppercase tracking-tight">Leaderboard</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-titanium-400 uppercase tracking-[0.2em] border-b border-titanium-100 pb-2">{gameType} Controls</h3>
                        {getContent()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export type ResponsiblePlaySettings = {
    realityCheckMinutes: number; // 0 = off
    maxWager: number; // 0 = unlimited
    maxLoss: number; // 0 = unlimited (absolute loss)
    maxSessionMinutes: number; // 0 = unlimited
    cooldownUntilMs: number; // 0 = none
    sessionStartMs: number; // 0 = not started
    pnlBaseline: number; // baseline of stats.pnlHistory at session start
    nextRealityCheckMs: number; // 0 = none scheduled
};

type ResponsiblePlayOverlayProps = {
    isOpen: boolean;
    mode?: 'settings' | 'reality';
    onClose: () => void;
    settings: ResponsiblePlaySettings;
    onChange: (next: ResponsiblePlaySettings) => void;
    summary: { sessionMinutes: number; netPnl: number; chips: number };
    onContinue: () => void;
    onCooldown: (minutes: number) => void;
    onStop: () => void;
};

export const ResponsiblePlayOverlay: React.FC<ResponsiblePlayOverlayProps> = ({
    isOpen,
    mode = 'settings',
    onClose,
    settings,
    onChange,
    summary,
    onContinue,
    onCooldown,
    onStop,
}) => {
    if (!isOpen) return null;

    const cooldownRemainingMs = settings.cooldownUntilMs > Date.now() ? settings.cooldownUntilMs - Date.now() : 0;
    const cooldownMinutes = Math.ceil(cooldownRemainingMs / 60_000);

    const setNumber = (key: keyof ResponsiblePlaySettings, val: string) => {
        const parsed = val === '' ? 0 : parseInt(val, 10);
        const nextValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        const next = { ...settings, [key]: nextValue };
        if (key === 'realityCheckMinutes') {
            next.nextRealityCheckMs = nextValue <= 0 ? 0 : (next.sessionStartMs > 0 ? Date.now() + nextValue * 60_000 : 0);
        }
        onChange(next as ResponsiblePlaySettings);
    };

    return (
        <div className="fixed inset-0 bg-titanium-900/60 backdrop-blur-lg z-[100] flex items-center justify-center p-6" onClick={onClose}>
            <div className="bg-white rounded-[40px] shadow-float max-w-xl w-full flex flex-col border border-titanium-200 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-10 border-b border-titanium-100 bg-titanium-50">
                    <div className="text-[10px] font-bold text-titanium-400 uppercase tracking-[0.2em] mb-3">
                        {mode === 'reality' ? 'Safety Notification' : 'Play Settings'}
                    </div>
                    <h2 className="text-3xl font-bold text-titanium-900 tracking-tight">Session Summary</h2>
                </div>

                <div className="p-10 space-y-10">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-titanium-50 p-5 rounded-3xl border border-titanium-100">
                            <span className="text-[9px] font-bold text-titanium-400 uppercase tracking-widest block mb-1">Duration</span>
                            <span className="text-lg font-bold text-titanium-900 tabular-nums">{summary.sessionMinutes}m</span>
                        </div>
                        <div className="bg-titanium-50 p-5 rounded-3xl border border-titanium-100">
                            <span className="text-[9px] font-bold text-titanium-400 uppercase tracking-widest block mb-1">Net PnL</span>
                            <span className={`text-lg font-bold tabular-nums ${summary.netPnl < 0 ? 'text-action-destructive' : 'text-action-success'}`}>
                                {summary.netPnl >= 0 ? '+' : '-'}${Math.abs(summary.netPnl).toLocaleString()}
                            </span>
                        </div>
                        <div className="bg-titanium-50 p-5 rounded-3xl border border-titanium-100">
                            <span className="text-[9px] font-bold text-titanium-400 uppercase tracking-widest block mb-1">Balance</span>
                            <span className="text-lg font-bold text-titanium-900 tabular-nums">${summary.chips.toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-bold text-titanium-900 uppercase tracking-tight">Reality Check</h4>
                                <p className="text-[11px] text-titanium-400 font-medium">Notification interval in minutes</p>
                            </div>
                            <select
                                className="bg-white border border-titanium-200 rounded-xl px-4 py-2 text-sm font-bold text-titanium-800 outline-none focus:border-action-primary transition-colors"
                                value={settings.realityCheckMinutes}
                                onChange={(e) => setNumber('realityCheckMinutes', e.target.value)}
                            >
                                <option value={0}>Disabled</option>
                                <option value={15}>15 mins</option>
                                <option value={30}>30 mins</option>
                                <option value={60}>1 hour</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-bold text-titanium-900 uppercase tracking-tight">Cooldown Mode</h4>
                                <p className="text-[11px] text-titanium-400 font-medium">{cooldownMinutes > 0 ? `Active for ${cooldownMinutes}m` : 'Pause gaming temporarily'}</p>
                            </div>
                            <div className="flex gap-2">
                                {[15, 30, 60].map(m => (
                                    <button 
                                        key={m}
                                        onClick={() => onCooldown(m)}
                                        className="w-10 h-10 rounded-full border border-titanium-200 text-xs font-bold text-titanium-800 hover:border-titanium-900 transition-colors"
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-10 border-t border-titanium-100 bg-titanium-50 flex items-center gap-4">
                    <button
                        onClick={onStop}
                        className="flex-1 h-14 rounded-full border-2 border-action-destructive text-action-destructive font-bold text-xs uppercase tracking-[0.2em] hover:bg-action-destructive/5 transition-colors"
                    >
                        End Session
                    </button>
                    <button
                        onClick={mode === 'reality' ? onContinue : onClose}
                        className="flex-1 h-14 rounded-full bg-titanium-900 text-white font-bold text-xs uppercase tracking-[0.2em] shadow-lg shadow-titanium-900/20"
                    >
                        {mode === 'reality' ? 'Keep Playing' : 'Save & Close'}
                    </button>
                </div>
            </div>
        </div>
    );
};
