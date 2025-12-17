import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';

interface HamburgerMenuProps {
    playMode: 'CASH' | 'FREEROLL' | null;
    onSetPlayMode: (mode: 'CASH' | 'FREEROLL' | null) => void;
    onOpenSafety: () => void;
    onToggleHelp: () => void;
    soundEnabled: boolean;
    onToggleSound: () => void;
    touchMode: boolean;
    onToggleTouchMode: () => void;
    reducedMotion: boolean;
    onToggleReducedMotion: () => void;
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
    playMode, onSetPlayMode, onOpenSafety, onToggleHelp,
    soundEnabled, onToggleSound, touchMode, onToggleTouchMode, reducedMotion, onToggleReducedMotion
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const toggle = () => setIsOpen(!isOpen);
    const close = () => setIsOpen(false);

    return (
        <div className="relative">
            <button 
                onClick={toggle} 
                aria-label="Menu"
                className="w-10 h-10 flex items-center justify-center rounded border border-gray-800 text-gray-300 bg-gray-900/50 hover:bg-gray-800"
            >
                <div className="flex flex-col gap-1.5">
                    <span className="w-5 h-0.5 bg-current rounded-full" />
                    <span className="w-5 h-0.5 bg-current rounded-full" />
                    <span className="w-5 h-0.5 bg-current rounded-full" />
                </div>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur-sm" onClick={close} />
                    <div className="absolute top-12 right-0 w-64 bg-black border border-gray-700 rounded-lg shadow-2xl z-[100] p-2 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                        <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-widest border-b border-gray-800 mb-1">
                            Menu
                        </div>
                        
                        <NavLink to="/" onClick={close} className={({ isActive }) => `px-3 py-3 rounded text-sm font-bold tracking-widest ${isActive ? 'bg-terminal-green/10 text-terminal-green' : 'text-gray-300 hover:bg-gray-800'}`}>
                            PLAY
                        </NavLink>
                        <NavLink to="/swap" onClick={close} className={({ isActive }) => `px-3 py-3 rounded text-sm font-bold tracking-widest ${isActive ? 'bg-terminal-green/10 text-terminal-green' : 'text-gray-300 hover:bg-gray-800'}`}>
                            SWAP
                        </NavLink>
                        <NavLink to="/stake" onClick={close} className={({ isActive }) => `px-3 py-3 rounded text-sm font-bold tracking-widest ${isActive ? 'bg-terminal-green/10 text-terminal-green' : 'text-gray-300 hover:bg-gray-800'}`}>
                            STAKE
                        </NavLink>
                        <NavLink to="/security" onClick={close} className={({ isActive }) => `px-3 py-3 rounded text-sm font-bold tracking-widest ${isActive ? 'bg-terminal-green/10 text-terminal-green' : 'text-gray-300 hover:bg-gray-800'}`}>
                            VAULT
                        </NavLink>

                        <div className="h-px bg-gray-800 my-1" />

                        <div className="px-3 py-2">
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Settings</div>
                            <div className="flex flex-col gap-3">
                                <button onClick={onToggleSound} className="flex justify-between items-center text-xs text-gray-300 hover:text-white">
                                    <span>SOUND</span>
                                    <span className={soundEnabled ? 'text-terminal-green font-bold' : 'text-gray-600'}>{soundEnabled ? 'ON' : 'OFF'}</span>
                                </button>
                                <button onClick={onToggleTouchMode} className="flex justify-between items-center text-xs text-gray-300 hover:text-white">
                                    <span>TOUCH</span>
                                    <span className={touchMode ? 'text-terminal-green font-bold' : 'text-gray-600'}>{touchMode ? 'ON' : 'OFF'}</span>
                                </button>
                                <button onClick={onToggleReducedMotion} className="flex justify-between items-center text-xs text-gray-300 hover:text-white">
                                    <span>MOTION</span>
                                    <span className={reducedMotion ? 'text-gray-600' : 'text-terminal-green font-bold'}>{reducedMotion ? 'LOW' : 'FULL'}</span>
                                </button>
                            </div>
                        </div>

                        <div className="h-px bg-gray-800 my-1" />

                        <button onClick={() => { onOpenSafety(); close(); }} className="px-3 py-3 rounded text-sm font-bold tracking-widest text-left text-gray-300 hover:bg-gray-800">
                            SAFETY
                        </button>
                        <button onClick={() => { onToggleHelp(); close(); }} className="px-3 py-3 rounded text-sm font-bold tracking-widest text-left text-gray-300 hover:bg-gray-800">
                            HELP
                        </button>

                        <div className="h-px bg-gray-800 my-1" />
                        
                        <div className="px-3 py-2">
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Mode</div>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => { onSetPlayMode('CASH'); close(); }}
                                    className={`flex-1 py-2 text-xs font-bold rounded border ${playMode === 'CASH' ? 'border-terminal-green bg-terminal-green text-black' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                                >
                                    CASH
                                </button>
                                <button 
                                    onClick={() => { onSetPlayMode('FREEROLL'); close(); }}
                                    className={`flex-1 py-2 text-xs font-bold rounded border ${playMode === 'FREEROLL' ? 'border-terminal-gold bg-terminal-gold text-black' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                                >
                                    TOURNEY
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
