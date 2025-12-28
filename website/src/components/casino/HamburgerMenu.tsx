import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AuthStatusPill } from '../AuthStatusPill';

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
    publicKeyHex?: string | null;
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
    playMode, onSetPlayMode, onOpenSafety, onToggleHelp,
    soundEnabled, onToggleSound, touchMode, onToggleTouchMode, reducedMotion, onToggleReducedMotion,
    publicKeyHex
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const toggle = () => setIsOpen(!isOpen);
    const close = () => setIsOpen(false);

    const NavItem = ({ to, label, onClick }: { to: string, label: string, onClick: () => void }) => (
        <NavLink 
            to={to} 
            onClick={onClick} 
            className={({ isActive }) => `px-4 py-3 rounded-2xl text-sm font-bold tracking-tight transition-all ${
                isActive 
                    ? 'bg-titanium-900 text-white shadow-lg' 
                    : 'text-titanium-800 hover:bg-titanium-100'
            }`}
        >
            {label}
        </NavLink>
    );

    return (
        <div className="relative">
            <button 
                onClick={toggle} 
                aria-label="Menu"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white border border-titanium-200 shadow-soft hover:shadow-md transition-shadow active:scale-95"
            >
                <div className="flex flex-col gap-1">
                    <span className={`w-4 h-0.5 bg-titanium-900 rounded-full transition-transform ${isOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
                    <span className={`w-4 h-0.5 bg-titanium-900 rounded-full transition-opacity ${isOpen ? 'opacity-0' : ''}`} />
                    <span className={`w-4 h-0.5 bg-titanium-900 rounded-full transition-transform ${isOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
                </div>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[90] bg-titanium-900/20 backdrop-blur-md" onClick={close} />
                    <div className="absolute top-12 right-0 w-72 bg-white border border-titanium-200 rounded-[32px] shadow-float z-[100] p-3 flex flex-col gap-1 animate-scale-in origin-top-right">
                        <div className="px-4 pt-4 pb-2">
                            <div className="text-[10px] font-bold text-titanium-400 uppercase tracking-[0.2em] mb-4">Navigation</div>
                            <div className="flex flex-col gap-1">
                                <NavItem to="/" label="Play" onClick={close} />
                                <NavItem to="/swap" label="Swap" onClick={close} />
                                <NavItem to="/stake" label="Stake" onClick={close} />
                                <NavItem to="/bridge" label="Bridge" onClick={close} />
                                <NavItem to="/security" label="Vault" onClick={close} />
                            </div>
                        </div>

                        <div className="h-px bg-titanium-100 my-2 mx-4" />

                        <div className="px-4 py-2">
                            <div className="text-[10px] font-bold text-titanium-400 uppercase tracking-[0.2em] mb-4">Settings</div>
                            <div className="flex flex-col gap-4">
                                <button onClick={onToggleSound} className="flex justify-between items-center group">
                                    <span className="text-sm font-semibold text-titanium-800">Sound</span>
                                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${soundEnabled ? 'bg-action-success/10 text-action-success' : 'bg-titanium-100 text-titanium-400'}`}>
                                        {soundEnabled ? 'On' : 'Off'}
                                    </span>
                                </button>
                                <button onClick={onToggleReducedMotion} className="flex justify-between items-center group">
                                    <span className="text-sm font-semibold text-titanium-800">Motion</span>
                                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${reducedMotion ? 'bg-titanium-100 text-titanium-400' : 'bg-action-success/10 text-action-success'}`}>
                                        {reducedMotion ? 'Low' : 'Full'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div className="h-px bg-titanium-100 my-2 mx-4" />

                        <div className="px-4 py-2">
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => { onOpenSafety(); close(); }}
                                    className="py-3 rounded-2xl bg-titanium-50 text-titanium-800 text-xs font-bold uppercase tracking-widest hover:bg-titanium-100 transition-colors"
                                >
                                    Safety
                                </button>
                                <button 
                                    onClick={() => { onToggleHelp(); close(); }}
                                    className="py-3 rounded-2xl bg-titanium-50 text-titanium-800 text-xs font-bold uppercase tracking-widest hover:bg-titanium-100 transition-colors"
                                >
                                    Help
                                </button>
                            </div>
                        </div>

                        <div className="px-4 pb-4 pt-2">
                            <div className="p-4 bg-titanium-50 rounded-2xl border border-titanium-100 flex flex-col items-center gap-3">
                                <span className="text-[9px] font-bold text-titanium-400 uppercase tracking-widest">Active Mode</span>
                                <div className="flex w-full gap-2">
                                    <button 
                                        onClick={() => { onSetPlayMode('CASH'); close(); }}
                                        className={`flex-1 py-2 text-[10px] font-bold rounded-full transition-all ${playMode === 'CASH' ? 'bg-titanium-900 text-white' : 'bg-white text-titanium-800 border border-titanium-200'}`}
                                    >
                                        Cash
                                    </button>
                                    <button 
                                        onClick={() => { onSetPlayMode('FREEROLL'); close(); }}
                                        className={`flex-1 py-2 text-[10px] font-bold rounded-full transition-all ${playMode === 'FREEROLL' ? 'bg-action-primary text-white' : 'bg-white text-titanium-800 border border-titanium-200'}`}
                                    >
                                        Tourney
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
