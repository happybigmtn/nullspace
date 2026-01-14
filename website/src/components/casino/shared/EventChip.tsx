import React from 'react';
import { formatCountdownShort, useWeeklyEvent } from '../../../hooks/useWeeklyEvent';

type EventChipProps = {
  className?: string;
  variant?: 'pill' | 'card';
};

export const EventChip: React.FC<EventChipProps> = ({ className, variant = 'pill' }) => {
  const { event, timeLeftMs } = useWeeklyEvent();

  if (!event) return null;

  const countdown = formatCountdownShort(timeLeftMs);
  const baseClass = variant === 'card'
    ? 'rounded-2xl border px-4 py-3 flex flex-col gap-2'
    : 'rounded-full border px-3 py-1.5 flex items-center gap-2';

  return (
    <div className={[baseClass, event.className, className ?? ''].join(' ').trim()}>
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">Event</span>
      <span className="text-xs font-bold">{event.label}</span>
      <span className="text-[10px] font-mono text-ns-muted">Ends in {countdown}</span>
    </div>
  );
};
