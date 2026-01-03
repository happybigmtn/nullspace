import React from 'react';
import { LeaderboardEntry, PlayerStats, GameType, CrapsEventLog, ResolvedBet } from '../../types';
import { formatTime, HELP_CONTENT, buildHistoryEntry, formatSummaryLine, prependPnlLine, formatPnlLabel } from '../../utils/gameUtils';
import { PanelDrawer } from './PanelDrawer';
import { Label } from './ui/Label';
import { ThemeToggle } from '../ui/ThemeToggle';

interface HeaderProps {
    phase: string;
    tournamentTime: number;
    stats: PlayerStats;
    lastTxSig?: string;
    focusMode: boolean;
    setFocusMode: (mode: boolean) => void;
    showTimer?: boolean;
    onOpenCommandPalette?: () => void;
    onToggleHelp?: () => void;
    touchMode?: boolean;
    onToggleTouchMode?: () => void;
    soundEnabled?: boolean;
    onToggleSound?: () => void;
    reducedMotion?: boolean;
    onToggleReducedMotion?: () => void;
    playMode?: 'CASH' | 'FREEROLL' | null;
    sessionActive?: boolean;
    sessionDelta?: number;
    sessionMinutes?: number;
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
    onOpenCommandPalette,
    onToggleHelp,
    touchMode = false,
    onToggleTouchMode,
    soundEnabled = true,
    onToggleSound,
    reducedMotion = false,
    onToggleReducedMotion,
    playMode,
    sessionActive = false,
    sessionDelta = 0,
    sessionMinutes = 0,
    children,
}) => {
    const sessionValue = formatPnlLabel(sessionDelta) || '$0';
    const sessionTone =
        sessionDelta > 0
            ? 'text-action-success'
            : sessionDelta < 0
                ? 'text-action-destructive'
                : 'text-titanium-600 dark:text-titanium-200';

    return (
        <header className="h-14 border-b border-titanium-200 flex items-center justify-between px-6 z-10 bg-glass-light backdrop-blur-xl sticky top-0 dark:border-titanium-800 dark:bg-glass-dark dark:text-titanium-100">
            <div className="flex items-center gap-4">
                <span className="font-display font-semibold tracking-tight text-titanium-900 dark:text-titanium-100 text-base">nullspace</span>
                {onOpenCommandPalette && (
                    <button
                        type="button"
                        onClick={onOpenCommandPalette}
                        className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-titanium-200 text-[10px] font-medium uppercase tracking-[0.18em] text-titanium-600 hover:text-titanium-900 hover:border-titanium-400 transition-colors dark:border-titanium-800 dark:text-titanium-300 dark:hover:text-titanium-100"
                    >
                        Games <span className="text-[9px] font-mono">/</span>
                    </button>
                )}
            </div>
            <div className="flex items-center gap-4">
                {showTimer && (
                    <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full border border-titanium-200 text-[10px] font-medium uppercase tracking-[0.18em] text-titanium-600 dark:border-titanium-800 dark:text-titanium-300">
                        <span>Timer</span>
                        <span className={`font-mono font-semibold tabular-nums ${tournamentTime < 60 ? 'text-action-destructive animate-pulse' : 'text-titanium-900 dark:text-titanium-100'}`}>{formatTime(tournamentTime)}</span>
                    </div>
                )}

                <div className="flex items-center gap-3">
                    {sessionActive && (
                        <div className="hidden md:flex flex-col items-end zen-hide">
                            <Label size="micro" className="mb-0.5">Session</Label>
                            <span className={`text-sm font-bold tabular-nums leading-none ${sessionTone}`}>
                                {sessionValue}
                            </span>
                            <span className="text-[9px] font-medium text-titanium-600 dark:text-titanium-300">
                                {sessionMinutes > 0 ? `${sessionMinutes}m` : 'Live'}
                            </span>
                        </div>
                    )}
                    <div className="flex flex-col items-end">
                        <Label size="micro" className="mb-0.5">Balance</Label>
                        <span className="text-titanium-900 dark:text-titanium-100 font-semibold text-base tracking-tight tabular-nums leading-none font-display">
                            ${stats.chips.toLocaleString()}
                        </span>
                    </div>
                </div>
                <ThemeToggle className="hidden md:inline-flex" />
                {children}
            </div>
        </header>
    );
};

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

interface SidebarProps {
    leaderboard: LeaderboardEntry[];
    history: string[];
    viewMode?: 'RANK' | 'PAYOUT';
    currentChips?: number;
    prizePool?: number;
    totalPlayers?: number;
    winnersPct?: number;
    gameType?: GameType;
    crapsEventLog?: CrapsEventLog[];
    resolvedBets?: ResolvedBet[];
    resolvedBetsKey?: number;
    onToggleView?: () => void;
}

const SidebarContent: React.FC<SidebarProps & { compact?: boolean }> = ({
    leaderboard,
    history,
    viewMode = 'RANK',
    currentChips,
    prizePool,
    totalPlayers,
    winnersPct = 0.15,
    gameType,
    crapsEventLog = [],
    resolvedBets = [],
    resolvedBetsKey = 0,
    onToggleView,
    compact = false,
}) => {
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
                <div className={`flex justify-between items-center py-2 px-4 rounded-xl transition-colors ${
                    isSticky
                        ? 'bg-titanium-900 text-white shadow-lg'
                        : isUser ? 'bg-titanium-100 text-titanium-900' : 'text-titanium-800'
                }`}>
                    <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold font-mono w-4 text-center ${isSticky ? 'text-titanium-400' : 'text-titanium-300'}`}>{rank}</span>
                        <span className={`text-sm font-semibold ${isSticky ? 'text-white' : 'text-titanium-800'}`}>{entry.name}</span>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${
                        isSticky ? 'text-white' :
                        viewMode === 'PAYOUT' && rank <= bubbleIndex ? 'text-action-success' : 'text-titanium-900'
                    }`}>
                        {viewMode === 'RANK' ? `$${Math.floor(displayChips).toLocaleString()}` : getPayout(rank)}
                    </span>
                </div>
                {!isSticky && isMoneyCutoff && (
                    <div className="border-b border-titanium-200 my-3 relative h-px mx-2">
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
            <div key={key} className="flex flex-col gap-1 py-3 border-b border-titanium-100 last:border-0 px-2">
                <div className="text-xs font-bold text-titanium-800 leading-tight"> &gt; {lines[0]}</div>
                {pnlLine && (
                    <div className={`${pnlClass} text-xs font-black tabular-nums`}>
                        {pnlLine}
                    </div>
                )}
                {detailLines.map((line, i) => (
                    <div key={i} className="text-[10px] font-medium text-titanium-600 leading-snug">
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
                className="bg-white border border-titanium-200 rounded-2xl px-4 py-2.5 flex items-center justify-between shadow-soft"
            >
                <span className="text-[11px] font-black text-titanium-900 uppercase tracking-tight truncate mr-2">{bet.label}</span>
                <span className={`text-[11px] font-black tabular-nums ${pnlClass}`}>{pnlText}</span>
            </div>
        );
    };

    return (
        <div className={`flex flex-col min-h-0 ${compact ? 'gap-5' : ''}`}>
            <div className={`${compact ? 'px-4 pt-4' : 'px-6 pt-8'} pb-4 flex-none`}>
                <div className="flex justify-between items-center">
                    <Label variant="primary">{viewMode === 'RANK' ? 'Live Feed' : 'Payouts'}</Label>
                    <button
                        onClick={onToggleView}
                        className="text-[10px] font-bold text-titanium-600 bg-titanium-100 px-3 py-1 rounded-full hover:bg-titanium-200 transition-colors"
                    >
                        View
                    </button>
                </div>
            </div>

            {userEntry && (
                <div className="flex-none px-4 pb-4">
                     {renderEntry(userEntry, 0, true)}
                </div>
            )}

            <div className={`overflow-y-auto px-4 space-y-1 ${compact ? 'max-h-56' : 'flex-1 min-h-0'} scrollbar-hide`}>
                {leaderboard.map((entry, i) => renderEntry(entry, i, false))}
            </div>

            {resolvedEntries.length > 0 && (
                <div className={`flex-none border-t border-titanium-200 ${compact ? 'px-4 pb-4 pt-3' : 'p-6 bg-titanium-50'}`}>
                    <Label className="mb-4 text-center block" size="micro">Last Resolved</Label>
                    <div className="flex flex-col gap-2">
                        {resolvedEntries.slice(0, 5).map((bet, i) => renderResolvedBet(bet, i))}
                    </div>
                </div>
            )}

            <div className={`flex-1 border-t border-titanium-200 flex flex-col min-h-0 ${compact ? 'px-4 pt-4 pb-3' : 'p-6 bg-white'}`}>
                <Label className="mb-4 block" size="micro">{isCraps ? 'Roll Log' : 'History'}</Label>
                <div className={`flex-1 overflow-y-auto flex flex-col scrollbar-hide min-h-0 ${compact ? 'max-h-48' : ''}`}>
                    {isCraps ? (
                        crapsEventLog.length === 0 ? (
                        <div className="text-titanium-500 text-xs italic">No rolls recorded.</div>
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
        </div>
    );
};

export const Sidebar: React.FC<SidebarProps> = (props) => (
    <aside className="w-72 border-l border-titanium-200 bg-white hidden lg:flex flex-col">
        <SidebarContent {...props} />
    </aside>
);

export const SidebarDrawer: React.FC<SidebarProps & { className?: string; open?: boolean; onOpenChange?: (open: boolean) => void }> = ({ className, open, onOpenChange, ...props }) => (
    <PanelDrawer
        label="Feed"
        title={props.viewMode === 'RANK' ? 'LIVE FEED' : 'PAYOUTS'}
        shortcutHint="Alt+L"
        className={className}
        open={open}
        onOpenChange={onOpenChange}
    >
        <SidebarContent {...props} compact />
    </PanelDrawer>
);

export const Footer: React.FC<{ currentBet?: number; className?: string }> = ({ currentBet, className }) => {
    const bets = [1, 5, 25, 100, 500, 1000, 5000, 10000, 50000];
    const isCustom = currentBet && !bets.includes(currentBet);

    return (
        <footer className={`hidden lg:flex fixed bottom-0 left-0 right-0 border-t border-titanium-200 bg-glass-light backdrop-blur-xl h-10 items-center justify-center gap-8 px-6 z-20 dark:border-titanium-800 dark:bg-glass-dark dark:text-titanium-100 ${className ?? ''}`}>
            <Label size="micro">Quick Bet Keys</Label>
            <div className="flex gap-6">
                {bets.map((bet, i) => {
                    const isSelected = currentBet === bet;
                    return (
                        <div key={i} className="flex items-center gap-2 group cursor-pointer">
                            <span className="text-titanium-500 text-[10px] font-mono group-hover:text-titanium-700">^ {i + 1}</span>
                            <span className={`text-xs font-black tabular-nums transition-all group-hover:scale-110 ${isSelected ? 'text-action-primary' : 'text-titanium-800'}`}>
                                ${bet >= 1000 ? `${bet/1000}k` : bet}
                            </span>
                        </div>
                    );
                })}
                <div className="flex items-center gap-2 group cursor-pointer">
                    <span className="text-titanium-500 text-[10px] font-mono group-hover:text-titanium-700">^0</span>
                    <span className={`text-xs font-black transition-all group-hover:scale-110 ${isCustom ? 'text-action-primary' : 'text-titanium-800'}`}>Custom</span>
                </div>
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
            className="fixed inset-0 bg-titanium-900/45 backdrop-blur-md z-[100] flex items-start justify-center pt-24 px-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-[640px] bg-white rounded-[32px] shadow-float overflow-hidden flex flex-col border border-titanium-300 max-h-[60vh] animate-scale-in dark:bg-titanium-900/85 dark:border-titanium-700"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-8 py-6 border-b border-titanium-200 flex items-center gap-4 bg-titanium-100/60 dark:border-titanium-700 dark:bg-titanium-900/70">
                    <span className="text-action-primary font-black text-xl font-mono">&gt;</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="flex-1 bg-transparent outline-none text-titanium-900 placeholder-titanium-600 font-bold text-xl tracking-tight dark:text-titanium-100 dark:placeholder-titanium-300"
                        placeholder="Search Nullspace..."
                        autoFocus
                    />
                    <div className="text-[10px] font-black text-titanium-700 bg-white border border-titanium-300 px-3 py-1.5 rounded-full uppercase tracking-widest dark:bg-titanium-800 dark:border-titanium-600 dark:text-titanium-200">Esc</div>
                </div>
                <div className="flex-1 overflow-y-auto py-4 scrollbar-hide">
                    {filtered.map((game, i) => (
                        <div
                            key={game}
                            onClick={() => onSelectGame(game)}
                            className="flex items-center justify-between px-8 py-4 hover:bg-titanium-100/80 cursor-pointer group transition-all active:scale-[0.99] dark:hover:bg-titanium-800/70"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-titanium-100 border border-titanium-300 flex items-center justify-center text-[10px] font-black text-titanium-700 group-hover:bg-action-primary group-hover:text-white transition-colors shadow-soft dark:bg-titanium-800 dark:border-titanium-700 dark:text-titanium-200">
                                    {i < 9 ? i + 1 : i === 9 ? 0 : ''}
                                </div>
                                <span className="text-titanium-900 font-bold text-lg tracking-tight group-hover:translate-x-1 transition-transform dark:text-titanium-100">{game}</span>
                            </div>
                            <span className="text-titanium-600 font-bold text-[10px] uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity dark:text-titanium-300">
                                Launch Game
                            </span>
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div className="px-8 py-12 text-titanium-600 text-center italic font-semibold dark:text-titanium-300">No results found.</div>
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
             <div className="bg-white rounded-[48px] p-12 shadow-float flex flex-col items-center gap-8 w-full max-w-md border border-titanium-200 animate-scale-in">
                 <Label size="micro" variant="primary">Set Custom Wager</Label>
                 <div className="flex items-center text-8xl text-titanium-900 font-extrabold tracking-tighter font-display">
                     <span className="text-titanium-200">$</span>
                     <input
                        ref={inputRef}
                        type="text"
                        value={betString}
                        readOnly
                        className="bg-transparent outline-none text-center w-full"
                     />
                 </div>
                 <div className="flex flex-col gap-4 w-full">
                    <div className="h-1.5 bg-titanium-100 rounded-full w-full overflow-hidden">
                        <div className="h-full bg-action-primary w-1/3 animate-pulse rounded-full shadow-lg shadow-action-primary/20" />
                    </div>
                    <div className="text-[11px] font-bold text-titanium-400 text-center uppercase tracking-[0.2em] mt-2">
                        Use number keys to enter amount
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
                <div className="bg-white rounded-[40px] shadow-float max-w-md w-full flex flex-col border border-titanium-200 overflow-hidden animate-scale-in">
                    <div className="p-10 border-b border-titanium-100 bg-titanium-50/50">
                         <Label variant="gold" size="micro" className="mb-3 block">Instruction Detail</Label>
                         <h2 className="text-3xl font-extrabold text-titanium-900 tracking-tight">{detailInfo.title}</h2>
                    </div>
                    <div className="p-10 space-y-10">
                        <div>
                            <Label variant="success" size="micro" className="mb-2 block">Win Condition</Label>
                            <p className="text-base text-titanium-800 font-semibold leading-relaxed">{detailInfo.win}</p>
                        </div>
                        <div>
                            <Label variant="destructive" size="micro" className="mb-2 block">Loss Condition</Label>
                            <p className="text-base text-titanium-800 font-semibold leading-relaxed">{detailInfo.loss}</p>
                        </div>
                        <div className="bg-titanium-50 p-6 rounded-3xl border border-titanium-100 shadow-inner-light">
                            <Label variant="primary" size="micro" className="mb-2 block opacity-50">Practical Example</Label>
                            <p className="text-xs text-titanium-600 font-bold font-mono leading-relaxed">{detailInfo.example}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-6 text-center text-xs font-black text-titanium-400 uppercase tracking-[0.3em] border-t border-titanium-100 hover:bg-titanium-50 transition-colors active:scale-95">
                        Back to List
                    </button>
                </div>
            </div>
        );
    };

    if (detail) return renderHelpDetail(detail);

    const renderGridItems = (items: {key: string, label: string}[]) => (
        <div className="grid grid-cols-2 gap-4">
            {items.map(item => (
                <div key={item.key} className="flex items-center gap-4 bg-titanium-50 border border-titanium-100 p-3 rounded-2xl shadow-soft group hover:bg-white transition-all">
                    <div className="w-11 h-11 flex items-center justify-center bg-titanium-900 text-white rounded-xl font-display font-black text-sm shadow-md group-hover:scale-110 transition-transform">
                        {item.key}
                    </div>
                    <span className="text-body-sm font-bold text-titanium-800 uppercase tracking-tight">{item.label}</span>
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
                return <div className="text-titanium-400 font-bold text-center py-12 italic">Standard interaction: [SPACE] to confirm.</div>;
        }
    };

    return (
        <div className="fixed inset-0 bg-titanium-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6" onClick={onClose}>
            <div className="bg-white rounded-[48px] shadow-float max-w-2xl w-full flex flex-col border border-titanium-200 overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="p-10 border-b border-titanium-100 flex justify-between items-center bg-titanium-50/50">
                    <div>
                        <h2 className="text-3xl font-extrabold text-titanium-900 tracking-tight">Manual</h2>
                        <Label variant="primary" size="micro" className="mt-1 block opacity-60">Keyboard shortcuts for power users</Label>
                    </div>
                    <button onClick={onClose} className="w-12 h-12 flex items-center justify-center bg-white rounded-full border border-titanium-200 text-titanium-400 hover:text-titanium-900 transition-all hover:scale-110 active:scale-90 shadow-soft">
                        ✕
                    </button>
                </div>

                <div className="p-10 overflow-y-auto space-y-12 scrollbar-hide">
                    <div className="space-y-6">
                        <Label variant="gold" size="micro" className="border-b border-titanium-100 pb-2 block">System Commands</Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
                            <div className="flex items-center gap-4 group cursor-pointer">
                                <div className="w-11 h-11 flex items-center justify-center bg-white border border-titanium-200 rounded-xl font-display font-black text-sm text-titanium-900 shadow-soft group-hover:scale-110 group-hover:border-action-primary transition-all">/</div>
                                <span className="text-body-sm font-bold text-titanium-800 uppercase tracking-tight">Games</span>
                            </div>
                            <div className="flex items-center gap-4 group cursor-pointer">
                                <div className="w-11 h-11 flex items-center justify-center bg-white border border-titanium-200 rounded-xl font-display font-black text-sm text-titanium-900 shadow-soft group-hover:scale-110 group-hover:border-action-primary transition-all">?</div>
                                <span className="text-body-sm font-bold text-titanium-800 uppercase tracking-tight">Help</span>
                            </div>
                            <div className="flex items-center gap-4 group cursor-pointer">
                                <div className="w-11 h-11 flex items-center justify-center bg-white border border-titanium-200 rounded-xl font-display font-black text-sm text-titanium-900 shadow-soft group-hover:scale-110 group-hover:border-action-primary transition-all">L</div>
                                <span className="text-body-sm font-bold text-titanium-800 uppercase tracking-tight">Feed</span>
                            </div>
                            <div className="flex items-center gap-4 group cursor-pointer">
                                <div className="w-11 h-11 flex items-center justify-center bg-white border border-titanium-200 rounded-xl font-display font-black text-[10px] text-titanium-900 shadow-soft group-hover:scale-110 group-hover:border-action-primary transition-all">ALT+Z</div>
                                <span className="text-body-sm font-bold text-titanium-800 uppercase tracking-tight">Zen</span>
                            </div>
                            <div className="flex items-center gap-4 group cursor-pointer">
                                <div className="w-11 h-11 flex items-center justify-center bg-white border border-titanium-200 rounded-xl font-display font-black text-[10px] text-titanium-900 shadow-soft group-hover:scale-110 group-hover:border-action-primary transition-all">ALT+R</div>
                                <span className="text-body-sm font-bold text-titanium-800 uppercase tracking-tight">Rewards</span>
                            </div>
                            <div className="flex items-center gap-4 group cursor-pointer">
                                <div className="w-11 h-11 flex items-center justify-center bg-white border border-titanium-200 rounded-xl font-display font-black text-[10px] text-titanium-900 shadow-soft group-hover:scale-110 group-hover:border-action-primary transition-all">ALT+S</div>
                                <span className="text-body-sm font-bold text-titanium-800 uppercase tracking-tight">Safety</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <Label variant="primary" size="micro" className="border-b border-titanium-100 pb-2 block underline-offset-8">Game Operations [{gameType}]</Label>
                        {getContent()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export type ResponsiblePlaySettings = {
    realityCheckMinutes: number;
    maxWager: number;
    maxLoss: number;
    maxSessionMinutes: number;
    cooldownUntilMs: number;
    sessionStartMs: number;
    pnlBaseline: number;
    nextRealityCheckMs: number;
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
            <div className="bg-white rounded-[48px] shadow-float max-xl w-full flex flex-col border border-titanium-200 overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="p-12 border-b border-titanium-100 bg-titanium-50/50 text-center">
                    <Label variant="destructive" size="micro" className="mb-4 block tracking-[0.4em]">
                        {mode === 'reality' ? 'Player Protection' : 'Operation Settings'}
                    </Label>
                    <h2 className="text-4xl font-extrabold text-titanium-900 tracking-tight font-display">Session Insight</h2>
                </div>

                <div className="p-12 space-y-12">
                    <div className="grid grid-cols-3 gap-6">
                        <div className="bg-titanium-50 p-6 rounded-[32px] border border-titanium-100 shadow-inner-light">
                            <Label size="micro" className="block mb-2 opacity-60">Time</Label>
                            <span className="text-2xl font-black text-titanium-900 tabular-nums">{summary.sessionMinutes}m</span>
                        </div>
                        <div className="bg-titanium-50 p-6 rounded-[32px] border border-titanium-100 shadow-inner-light">
                            <Label size="micro" className="block mb-2 opacity-60">Return</Label>
                            <span className={`text-2xl font-black tabular-nums ${summary.netPnl < 0 ? 'text-action-destructive' : 'text-action-success'}`}>
                                {summary.netPnl >= 0 ? '+' : '-'}${Math.abs(summary.netPnl).toLocaleString()}
                            </span>
                        </div>
                        <div className="bg-titanium-50 p-6 rounded-[32px] border border-titanium-100 shadow-inner-light">
                            <Label size="micro" className="block mb-2 opacity-60">Bankroll</Label>
                            <span className="text-2xl font-black text-titanium-900 tabular-nums">${summary.chips.toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="space-y-8">
                        <div className="flex items-center justify-between group">
                            <div>
                                <h4 className="text-base font-black text-titanium-900 uppercase tracking-tight">Reality Check</h4>
                                <p className="text-xs text-titanium-400 font-bold">Notification cadence</p>
                            </div>
                            <select
                                className="bg-titanium-50 border border-titanium-200 rounded-2xl px-6 py-3 text-sm font-black text-titanium-800 outline-none focus:border-action-primary transition-all shadow-soft"
                                value={settings.realityCheckMinutes}
                                onChange={(e) => setNumber('realityCheckMinutes', e.target.value)}
                            >
                                <option value={0}>Deactivated</option>
                                <option value={15}>15 Minutes</option>
                                <option value={30}>30 Minutes</option>
                                <option value={60}>60 Minutes</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-base font-black text-titanium-900 uppercase tracking-tight">Cooldown Mode</h4>
                                <p className="text-xs text-titanium-400 font-bold">{cooldownMinutes > 0 ? `Active for ${cooldownMinutes}m` : 'Pause active participation'}</p>
                            </div>
                            <div className="flex gap-3">
                                {[15, 30, 60].map(m => (
                                    <button 
                                        key={m}
                                        onClick={() => onCooldown(m)}
                                        className="w-12 h-12 rounded-2xl border border-titanium-200 text-xs font-black text-titanium-800 hover:bg-titanium-900 hover:text-white transition-all shadow-soft active:scale-90"
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-12 border-t border-titanium-100 bg-titanium-50/50 flex items-center gap-6">
                    <button
                        onClick={onStop}
                        className="flex-1 h-16 rounded-full border-2 border-action-destructive text-action-destructive font-black text-xs uppercase tracking-[0.3em] hover:bg-action-destructive text-white transition-all active:scale-95 shadow-lg shadow-action-destructive/10"
                    >
                        End Session
                    </button>
                    <button
                        onClick={mode === 'reality' ? onContinue : onClose}
                        className="flex-1 h-16 rounded-full bg-titanium-900 text-white font-black text-xs uppercase tracking-[0.3em] shadow-xl shadow-titanium-900/30 hover:scale-[1.02] active:scale-95 transition-all"
                    >
                        {mode === 'reality' ? 'Continue' : 'Acknowledge'}
                    </button>
                </div>
            </div>
        </div>
    );
};
