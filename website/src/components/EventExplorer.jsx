import React, { useState, useEffect, useRef } from 'react';
import { generateTrainerName } from '../utils/trainerUtils';
import { logDebug } from '../utils/logger.js';

const EventExplorer = ({ client, onBack }) => {
  const [events, setEvents] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const unsubscribeRef = useRef(null);
  const [newEventIds, setNewEventIds] = useState(new Set());
  const MAX_EVENTS = 100; // Keep only 100 most recent events

  useEffect(() => {
    if (!client) return;

    // Switch to 'all' filter when entering explorer
    const switchToAllEvents = async () => {
      try {
        logDebug('Switching to all events stream for EventExplorer');
        await client.switchUpdates(null); // null = all events
      } catch (error) {
        console.error('Failed to switch to all events:', error);
      }
    };

    switchToAllEvents();

    // Switch back to account filter when leaving
    return () => {
      const switchToAccountEvents = async () => {
        try {
          logDebug('Switching back to account-specific events');
          // Get the current public key from the nonce manager
          const publicKey = client.nonceManager.publicKeyBytes;
          if (!publicKey) {
            throw new Error('No public key available to switch back to account events');
          }
          await client.switchUpdates(publicKey);
        } catch (error) {
          console.error('Failed to switch back to account events:', error);
        }
      };
      switchToAccountEvents();
    };
  }, [client]);

  useEffect(() => {
    if (!client || isPaused) return;

    // Subscribe to all events
    unsubscribeRef.current = client.onEvent('*', (event) => {
      // Filter out Seed events
      if (event.type === 'Seed') return;

      const eventId = `${event.type}-${Date.now()}-${Math.random()}`;

      setEvents(prev => {
        // Add new event at the beginning (newest first)
        const newEvents = [{ ...event, timestamp: Date.now(), id: eventId }, ...prev];
        // Keep only MAX_EVENTS to prevent memory issues
        if (newEvents.length > MAX_EVENTS) {
          return newEvents.slice(0, MAX_EVENTS);
        }
        return newEvents;
      });

      // Mark this event as new for animation
      setNewEventIds(prev => new Set([...prev, eventId]));

      // Remove from new events after animation completes
      setTimeout(() => {
        setNewEventIds(prev => {
          const next = new Set(prev);
          next.delete(eventId);
          return next;
        });
      }, 300);
    });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [client, isPaused]);

  const getMoveType = (moveIndex) => {
    if (moveIndex === 0) return 'DEFEND';
    return `ATTACK ${moveIndex}`;
  };

  const getInstructionDisplay = (instruction) => {
    if (typeof instruction === 'string') {
      return instruction;
    }
    if (instruction && typeof instruction === 'object') {
      if (instruction.type) return instruction.type;
      return Object.keys(instruction)[0] || 'Unknown';
    }
    return 'Unknown';
  };

  const Line = ({ label, value, mono = false, className = '' }) => (
    <div className={`text-[11px] text-ns ${className}`.trim()}>
      <span className="text-ns-muted">{label}:</span>{' '}
      <span className={mono ? 'font-mono break-all' : undefined}>{value}</span>
    </div>
  );

  const Section = ({ title, children }) => (
    <div className="liquid-panel p-3">
      <div className="text-[10px] uppercase tracking-[0.28em] text-ns-muted">{title}</div>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );

  const EventCard = ({ title, time, children }) => (
    <div className="liquid-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.32em] text-ns-muted">{title}</div>
        <div className="text-[10px] text-ns-muted">{time}</div>
      </div>
      <div className="mt-3 space-y-1">{children}</div>
    </div>
  );

  const renderEventCard = (event) => {
    const time = new Date(event.timestamp).toLocaleTimeString();

    switch (event.type) {
      case 'Generated':
        return (
          <EventCard title="Character generated" time={time}>
            <Line label="Player" value={generateTrainerName(event.account)} />
            <Line label="Account" value={event.account} mono />
            {event.creature_name && <Line label="Creature" value={event.creature_name} />}
            {event.creature && (
              <>
                {!event.creature_name && event.creature.name && (
                  <Line label="Creature" value={event.creature.name} />
                )}
                {event.creature.health !== undefined && (
                  <Line label="Health" value={`${event.creature.health} HP`} />
                )}
                {event.creature.type && <Line label="Type" value={event.creature.type} />}
                {event.creature.moves && event.creature.moves.length > 0 && (
                  <Line label="Moves" value={event.creature.moves.length} />
                )}
              </>
            )}
            {event.nonce !== undefined && <Line label="Nonce" value={event.nonce} />}
          </EventCard>
        );

      case 'Matched':
        return (
          <EventCard title="Battle matched" time={time}>
            <Line label="Player A" value={generateTrainerName(event.player_a)} />
            <Line label="Player B" value={generateTrainerName(event.player_b)} />
            <Line label="Battle ID" value={event.battle} mono />
            {event.turn !== undefined && <Line label="Starting turn" value={event.turn} />}
            {event.expiry !== undefined && <Line label="First move expiry" value={event.expiry} />}
          </EventCard>
        );

      case 'Moved': {
        const playerAKO = event.player_a_health === 0;
        const playerBKO = event.player_b_health === 0;
        const playerAMove = event.player_a_move !== undefined
          ? `${getMoveType(event.player_a_move)}${event.player_a_power !== undefined && event.player_a_power > 0 ? ` (Power ${event.player_a_power})` : ''}`
          : null;
        const playerBMove = event.player_b_move !== undefined
          ? `${getMoveType(event.player_b_move)}${event.player_b_power !== undefined && event.player_b_power > 0 ? ` (Power ${event.player_b_power})` : ''}`
          : null;

        return (
          <EventCard title="Move revealed" time={time}>
            <Line label="Battle" value={event.battle} mono />
            <Line label="Round" value={event.round} />
            {event.expiry !== undefined && <Line label="Next move deadline" value={event.expiry} />}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Section title={`Player A${playerAKO ? ' · KO' : ''}`}>
                {event.player_a_health !== undefined && (
                  <Line label="Health" value={`${event.player_a_health} HP`} />
                )}
                {playerAMove && <Line label="Move" value={playerAMove} />}
              </Section>
              <Section title={`Player B${playerBKO ? ' · KO' : ''}`}>
                {event.player_b_health !== undefined && (
                  <Line label="Health" value={`${event.player_b_health} HP`} />
                )}
                {playerBMove && <Line label="Move" value={playerBMove} />}
              </Section>
            </div>
          </EventCard>
        );
      }

      case 'Locked':
        return (
          <EventCard title="Move locked" time={time}>
            <Line label="Battle" value={event.battle} mono />
            {event.locker && <Line label="Locker" value={event.locker} mono />}
            {event.observer && <Line label="Observer" value={event.observer} mono />}
            {event.round !== undefined && <Line label="Round" value={event.round} />}
            {event.ciphertext && <Line label="Ciphertext" value={event.ciphertext} mono />}
          </EventCard>
        );

      case 'Transaction':
        return (
          <EventCard title="Transaction" time={time}>
            {event.instruction && (
              <Line label="Instruction" value={getInstructionDisplay(event.instruction)} />
            )}
            {event.nonce !== undefined && <Line label="Nonce" value={event.nonce} />}
            {event.public && <Line label="Public" value={event.public} mono />}
          </EventCard>
        );

      case 'Settled': {
        let winnerName = 'DRAW';
        if (event.outcome === 'PlayerA' && event.player_a) {
          winnerName = generateTrainerName(event.player_a);
        } else if (event.outcome === 'PlayerB' && event.player_b) {
          winnerName = generateTrainerName(event.player_b);
        }

        const playerAEloChange = (event.player_a_new?.elo ?? 0) - (event.player_a_old?.elo ?? 0);
        const playerBEloChange = (event.player_b_new?.elo ?? 0) - (event.player_b_old?.elo ?? 0);

        return (
          <EventCard title="Battle settled" time={time}>
            <Line label="Battle" value={event.battle} mono />
            <Line label="Winner" value={winnerName} className="font-semibold" />
            {event.round !== undefined && <Line label="Rounds" value={event.round} />}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Section title={`${generateTrainerName(event.player_a)} · Player A`}>
                <Line
                  label="ELO"
                  value={`${event.player_a_new?.elo ?? '-'} (${playerAEloChange > 0 ? '+' : ''}${playerAEloChange})`}
                />
              </Section>
              <Section title={`${generateTrainerName(event.player_b)} · Player B`}>
                <Line
                  label="ELO"
                  value={`${event.player_b_new?.elo ?? '-'} (${playerBEloChange > 0 ? '+' : ''}${playerBEloChange})`}
                />
              </Section>
            </div>
          </EventCard>
        );
      }

      default:
        return (
          <EventCard title={event.type?.toUpperCase() || 'UNKNOWN'} time={time}>
            {Object.entries(event)
              .filter(([key]) => key !== 'type' && key !== 'timestamp')
              .map(([key, value]) => (
                <Line
                  key={key}
                  label={key}
                  value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  mono={typeof value === 'string' && value.length > 16}
                />
              ))}
          </EventCard>
        );
    }
  };

  return (
    <div className="min-h-screen liquid-shell text-ns font-sans">
      {/* Fixed Header */}
      <div className="sticky top-0 z-10">
        <div className="border-b border-black/5 dark:border-white/10 bg-white/70 dark:bg-black/30 backdrop-blur-xl">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-4">
            <div className="liquid-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Live stream</div>
                  <div className="text-lg font-display tracking-tight text-ns">Event Explorer</div>
                  <div className="text-[11px] text-ns-muted">
                    Real-time protocol events for ops and debugging.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPaused(!isPaused)}
                    className="px-4 py-2 rounded-full liquid-chip text-[10px] uppercase tracking-[0.28em] text-ns hover:shadow-soft"
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    onClick={onBack}
                    className="px-4 py-2 rounded-full liquid-chip text-[10px] uppercase tracking-[0.28em] text-ns hover:shadow-soft"
                  >
                    Back
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6">
        {events.length === 0 ? (
          <div className="text-[11px] text-ns-muted">Waiting for events...</div>
        ) : (
          <div className="space-y-3">
            {events.map((event, idx) => (
              <div
                key={event.id || idx}
                className={newEventIds.has(event.id) ? 'animate-slideIn' : ''}
              >
                {renderEventCard(event)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EventExplorer;
