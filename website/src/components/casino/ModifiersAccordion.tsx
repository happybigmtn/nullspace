import React, { useState } from 'react';
import { ChevronDown, Shield, Zap, Sparkles } from 'lucide-react';
import { animated, useSpring } from '@react-spring/web';

/**
 * LUX-012: Modifiers Accordion
 *
 * Consolidates SHIELD, DOUBLE, SUPER modifiers into an expandable section.
 * - Collapsed: Shows "Modifiers" with count badge if any active
 * - Expanded: Shows only available modifiers as toggles
 * - Disabled modifiers are hidden, not grayed
 */

interface Modifier {
    id: 'shield' | 'double' | 'super';
    label: string;
    icon: React.ReactNode;
    description: string;
    active: boolean;
    available: boolean;
    onToggle: () => void;
}

interface ModifiersAccordionProps {
    modifiers: {
        shield?: { active: boolean; available: boolean; onToggle: () => void };
        double?: { active: boolean; available: boolean; onToggle: () => void };
        super?: { active: boolean; available: boolean; onToggle: () => void };
    };
    className?: string;
}

const MODIFIER_CONFIG: Record<'shield' | 'double' | 'super', { label: string; icon: React.ReactNode; description: string }> = {
    shield: {
        label: 'SHIELD',
        icon: <Shield className="w-4 h-4" />,
        description: 'Protect bet on loss',
    },
    double: {
        label: 'DOUBLE',
        icon: <Zap className="w-4 h-4" />,
        description: '2x payout multiplier',
    },
    super: {
        label: 'SUPER',
        icon: <Sparkles className="w-4 h-4" />,
        description: 'Enhanced multipliers',
    },
};

export const ModifiersAccordion: React.FC<ModifiersAccordionProps> = ({
    modifiers,
    className = '',
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Build list of available modifiers
    const availableModifiers: Modifier[] = [];
    for (const [key, config] of Object.entries(MODIFIER_CONFIG)) {
        const mod = modifiers[key as keyof typeof modifiers];
        if (mod?.available) {
            availableModifiers.push({
                id: key as 'shield' | 'double' | 'super',
                ...config,
                active: mod.active,
                available: mod.available,
                onToggle: mod.onToggle,
            });
        }
    }

    // Count active modifiers
    const activeCount = availableModifiers.filter((m) => m.active).length;

    // Don't render if no modifiers available
    if (availableModifiers.length === 0) {
        return null;
    }

    // Chevron rotation animation
    const chevronSpring = useSpring({
        rotate: isExpanded ? 180 : 0,
        config: { tension: 300, friction: 20 },
    });

    // Content height animation
    const contentSpring = useSpring({
        height: isExpanded ? availableModifiers.length * 48 : 0,
        opacity: isExpanded ? 1 : 0,
        config: { tension: 300, friction: 26 },
    });

    return (
        <div className={`liquid-panel rounded-2xl border border-ns overflow-hidden ${className}`}>
            {/* Header / Toggle */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-ns-surface transition-colors motion-interaction"
                aria-expanded={isExpanded}
                aria-controls="modifiers-content"
            >
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ns">Modifiers</span>
                    {activeCount > 0 && (
                        <span className="px-2 py-0.5 text-[10px] font-bold bg-mono-0 text-white rounded-full">
                            {activeCount}
                        </span>
                    )}
                </div>
                <animated.div style={{ transform: chevronSpring.rotate.to((r) => `rotate(${r}deg)`) }}>
                    <ChevronDown className="w-4 h-4 text-ns-muted" />
                </animated.div>
            </button>

            {/* Expandable Content */}
            <animated.div
                id="modifiers-content"
                style={{
                    height: contentSpring.height,
                    opacity: contentSpring.opacity,
                    overflow: 'hidden',
                }}
            >
                <div className="px-4 pb-3 space-y-1">
                    {availableModifiers.map((mod) => (
                        <button
                            key={mod.id}
                            type="button"
                            onClick={mod.onToggle}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all motion-interaction ${
                                mod.active
                                    ? 'bg-mono-0 text-white'
                                    : 'bg-ns-surface text-ns border border-ns hover:border-ns'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <span className={mod.active ? 'text-white' : 'text-ns-muted'}>
                                    {mod.icon}
                                </span>
                                <span className="text-xs font-bold tracking-wider">{mod.label}</span>
                            </div>
                            <span className={`text-[10px] ${mod.active ? 'text-white/70' : 'text-ns-muted'}`}>
                                {mod.description}
                            </span>
                        </button>
                    ))}
                </div>
            </animated.div>
        </div>
    );
};
