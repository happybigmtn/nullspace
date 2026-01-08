/**
 * Decodes chain events into typed TypeScript objects for rendering.
 *
 * This is DECODING ONLY - the chain has already computed game state.
 * We simply parse the binary event data into renderable types.
 *
 * This module also provides utilities for validating protocol version headers
 * on encoded messages.
 */

import type { Card, Suit, Rank, GameType } from '@nullspace/types';
import { ProtocolError } from './errors.js';
import {
  validateVersion,
  stripVersionHeader,
  peekVersion,
  UnsupportedProtocolVersionError,
  CURRENT_PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  MAX_PROTOCOL_VERSION,
} from './version.js';

// Re-export version utilities for decode consumers
export {
  validateVersion,
  stripVersionHeader,
  peekVersion,
  UnsupportedProtocolVersionError,
  CURRENT_PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  MAX_PROTOCOL_VERSION,
};

const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const STAGES = ['betting', 'playing', 'dealer_turn', 'complete'] as const;

/** Decode a card from chain binary format */
export function decodeCard(data: Uint8Array, offset: number): Card {
  if (offset + 3 > data.length) {
    throw new ProtocolError(`Invalid card data: expected 3 bytes at offset ${offset}, got ${data.length - offset}`);
  }

  const suitByte = data[offset];
  const rankByte = data[offset + 1];
  const faceUpByte = data[offset + 2];

  if (suitByte >= SUITS.length) {
    throw new ProtocolError(`Invalid suit byte: ${suitByte}, expected 0-${SUITS.length - 1}`);
  }
  if (rankByte >= RANKS.length) {
    throw new ProtocolError(`Invalid rank byte: ${rankByte}, expected 0-${RANKS.length - 1}`);
  }

  return {
    suit: SUITS[suitByte],
    rank: RANKS[rankByte],
    faceUp: faceUpByte !== 0,
  };
}

/** Decode multiple cards from chain event payload */
export function decodeCards(data: Uint8Array, count: number, startOffset: number): Card[] {
  const expectedBytes = count * 3;
  if (startOffset + expectedBytes > data.length) {
    throw new ProtocolError(
      `Invalid cards data: expected ${expectedBytes} bytes at offset ${startOffset}, got ${data.length - startOffset}`
    );
  }

  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    cards.push(decodeCard(data, startOffset + i * 3));
  }
  return cards;
}

/** Decoded game result event */
export interface DecodedGameResult {
  sessionId: bigint;
  gameType: GameType;
  won: boolean;
  payout: bigint;
  message: string;
}

/** Decode a game result event */
export function decodeGameResult(data: Uint8Array): DecodedGameResult {
  const minLength = 19; // 8 + 1 + 1 + 8 + 1
  if (data.length < minLength) {
    throw new ProtocolError(`Invalid game result data: expected at least ${minLength} bytes, got ${data.length}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sessionId = view.getBigUint64(0, true);
  const gameTypeByte = view.getUint8(8);
  
  if (gameTypeByte > 9) {
    throw new ProtocolError(`Invalid game type byte: ${gameTypeByte}, expected 0-9`);
  }
  
  const gameType = gameTypeByte as GameType;
  const won = view.getUint8(9) !== 0;
  const payout = view.getBigUint64(10, true);
  const msgLen = view.getUint8(18);
  
  if (19 + msgLen > data.length) {
    throw new ProtocolError(`Invalid message length: ${msgLen}, exceeds available data`);
  }
  
  const msgBytes = data.slice(19, 19 + msgLen);
  const message = new TextDecoder().decode(msgBytes);

  return { sessionId, gameType, won, payout, message };
}

/** Decoded blackjack state event */
export interface DecodedBlackjackState {
  sessionId: bigint;
  playerCards: Card[];
  dealerCards: Card[];
  playerTotal: number;   // Computed by chain, just render it
  dealerTotal: number;   // Computed by chain, just render it
  stage: typeof STAGES[number];
  canHit: boolean;       // Chain tells us what actions are valid
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
}

/** Decode blackjack state update from chain */
export function decodeBlackjackState(data: Uint8Array): DecodedBlackjackState {
  if (data.length < 8) {
    throw new ProtocolError(`Invalid blackjack state: expected at least 8 bytes, got ${data.length}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const sessionId = view.getBigUint64(offset, true); offset += 8;
  
  if (offset >= data.length) {
    throw new ProtocolError('Invalid blackjack state: missing player card count');
  }
  const playerCardCount = view.getUint8(offset); offset += 1;
  
  const playerCards = decodeCards(data, playerCardCount, offset); 
  offset += playerCardCount * 3;
  
  if (offset >= data.length) {
    throw new ProtocolError('Invalid blackjack state: missing dealer card count');
  }
  const dealerCardCount = view.getUint8(offset); offset += 1;
  
  const dealerCards = decodeCards(data, dealerCardCount, offset); 
  offset += dealerCardCount * 3;
  
  if (offset + 4 > data.length) {
    throw new ProtocolError('Invalid blackjack state: missing totals and stage');
  }
  const playerTotal = view.getUint8(offset); offset += 1;
  const dealerTotal = view.getUint8(offset); offset += 1;
  const stageByte = view.getUint8(offset); offset += 1;
  
  if (stageByte >= STAGES.length) {
    throw new ProtocolError(`Invalid stage byte: ${stageByte}, expected 0-3`);
  }
  
  const actionFlags = view.getUint8(offset);

  return {
    sessionId,
    playerCards,
    dealerCards,
    playerTotal,
    dealerTotal,
    stage: STAGES[stageByte],
    canHit: (actionFlags & 0x01) !== 0,
    canStand: (actionFlags & 0x02) !== 0,
    canDouble: (actionFlags & 0x04) !== 0,
    canSplit: (actionFlags & 0x08) !== 0,
  };
}

/**
 * Decoded versioned payload result
 */
export interface DecodedVersionedPayload {
  /** Protocol version from the header */
  version: number;
  /** The opcode (first byte after version) */
  opcode: number;
  /** Raw payload data (after version byte) */
  payload: Uint8Array;
}

/**
 * Decode a versioned game move payload
 *
 * Validates the version header and extracts the opcode and payload.
 * Use this when receiving encoded messages to validate protocol compatibility.
 *
 * @throws UnsupportedProtocolVersionError if version is not supported
 * @throws ProtocolError if message is too short
 */
export function decodeVersionedPayload(data: Uint8Array): DecodedVersionedPayload {
  if (data.length < 2) {
    throw new ProtocolError('Versioned payload too short: expected at least 2 bytes (version + opcode)');
  }

  const { version, payload } = stripVersionHeader(data);
  const opcode = payload[0];

  return {
    version,
    opcode,
    payload,
  };
}

/**
 * Check if a payload has a valid version header without throwing
 *
 * Returns the version if valid, or null if invalid/missing
 */
export function tryDecodeVersion(data: Uint8Array): { version: number; isSupported: boolean } | null {
  const version = peekVersion(data);
  if (version === null) {
    return null;
  }

  return {
    version,
    isSupported: version >= MIN_PROTOCOL_VERSION && version <= MAX_PROTOCOL_VERSION,
  };
}
