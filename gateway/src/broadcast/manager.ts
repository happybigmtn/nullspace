/**
 * Broadcast Manager for WebSocket Fanout (AC-3.3)
 *
 * Implements fanout with backpressure controls:
 * - Per-client bounded send queues to prevent memory pressure from slow clients
 * - Tail-drop policy when queues overflow (real-time data: newer is more relevant)
 * - Concurrent send with configurable parallelism
 * - Metrics for dropped messages and queue depths
 *
 * Design notes:
 * - Uses a "fire and forget" model with bounded queues per subscriber
 * - Slow clients get their oldest messages dropped (tail-drop)
 * - Queue depth metrics allow monitoring for consistently slow clients
 */
import type { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { logDebug, logWarn } from '../logger.js';
import { metrics } from '../metrics/index.js';

/**
 * Message queued for broadcast
 */
interface QueuedMessage {
  payload: string;
  timestamp: number;
  topic?: string;
}

/**
 * Per-subscriber state
 */
interface SubscriberState {
  ws: WebSocket;
  queue: QueuedMessage[];
  sending: boolean;
  dropped: number;
  topics: Set<string>;
}

/**
 * Broadcast manager configuration
 */
export interface BroadcastManagerConfig {
  /** Maximum queue depth per subscriber (default: 100) */
  maxQueueDepth?: number;
  /** Warn when queue depth exceeds this threshold (default: 50) */
  queueWarnThreshold?: number;
  /** Maximum concurrent sends per flush cycle (default: 50) */
  maxConcurrentSends?: number;
  /** Flush interval in milliseconds (default: 10) */
  flushIntervalMs?: number;
}

const DEFAULT_CONFIG: Required<BroadcastManagerConfig> = {
  maxQueueDepth: 100,
  queueWarnThreshold: 50,
  maxConcurrentSends: 50,
  flushIntervalMs: 10,
};

/**
 * Manages fanout of messages to multiple WebSocket clients with backpressure.
 *
 * Usage:
 *   const broadcast = new BroadcastManager();
 *   broadcast.subscribe(ws);              // Add client
 *   broadcast.publish(msg);               // Send to all
 *   broadcast.publishToTopic('table:1', msg);  // Send to topic subscribers
 *   broadcast.unsubscribe(ws);            // Remove client
 */
export class BroadcastManager extends EventEmitter {
  private subscribers: Map<WebSocket, SubscriberState> = new Map();
  private config: Required<BroadcastManagerConfig>;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(config: BroadcastManagerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the flush timer for processing queued messages
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushQueues(), this.config.flushIntervalMs);
    // Don't prevent process exit
    this.flushTimer.unref?.();
    logDebug('[BroadcastManager] Started with flush interval', this.config.flushIntervalMs);
  }

  /**
   * Stop the flush timer
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Add a subscriber to receive broadcasts
   */
  subscribe(ws: WebSocket, topics?: string[]): void {
    if (this.subscribers.has(ws)) {
      // Already subscribed - just update topics
      const state = this.subscribers.get(ws)!;
      if (topics) {
        for (const topic of topics) {
          state.topics.add(topic);
        }
      }
      return;
    }

    this.subscribers.set(ws, {
      ws,
      queue: [],
      sending: false,
      dropped: 0,
      topics: new Set(topics ?? []),
    });

    metrics.set('gateway.broadcast.subscribers', this.subscribers.size);
    logDebug('[BroadcastManager] Subscriber added, total:', this.subscribers.size);
  }

  /**
   * Subscribe a client to a specific topic
   */
  subscribeToTopic(ws: WebSocket, topic: string): void {
    const state = this.subscribers.get(ws);
    if (state) {
      state.topics.add(topic);
    } else {
      this.subscribe(ws, [topic]);
    }
  }

  /**
   * Unsubscribe a client from a specific topic
   */
  unsubscribeFromTopic(ws: WebSocket, topic: string): void {
    const state = this.subscribers.get(ws);
    if (state) {
      state.topics.delete(topic);
    }
  }

  /**
   * Remove a subscriber
   */
  unsubscribe(ws: WebSocket): void {
    const state = this.subscribers.get(ws);
    if (state) {
      if (state.dropped > 0) {
        logDebug('[BroadcastManager] Subscriber removed with', state.dropped, 'dropped messages');
        metrics.increment('gateway.broadcast.total_dropped', state.dropped);
      }
      this.subscribers.delete(ws);
      metrics.set('gateway.broadcast.subscribers', this.subscribers.size);
    }
  }

  /**
   * Check if a client is subscribed
   */
  isSubscribed(ws: WebSocket): boolean {
    return this.subscribers.has(ws);
  }

  /**
   * Get the number of subscribers
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Publish a message to all subscribers
   *
   * @param message - Message to broadcast (will be JSON.stringify'd if object)
   * @returns Number of subscribers message was queued for
   */
  publish(message: string | Record<string, unknown>): number {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const now = Date.now();
    let queued = 0;

    for (const state of this.subscribers.values()) {
      if (this.enqueue(state, { payload, timestamp: now })) {
        queued++;
      }
    }

    metrics.increment('gateway.broadcast.messages_published');
    return queued;
  }

  /**
   * Publish a message to subscribers of a specific topic
   *
   * @param topic - Topic to publish to (e.g., 'table:1', 'round:123')
   * @param message - Message to broadcast
   * @returns Number of subscribers message was queued for
   */
  publishToTopic(topic: string, message: string | Record<string, unknown>): number {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const now = Date.now();
    let queued = 0;

    for (const state of this.subscribers.values()) {
      if (state.topics.has(topic) && this.enqueue(state, { payload, timestamp: now, topic })) {
        queued++;
      }
    }

    metrics.increment(`gateway.broadcast.topic.${topic.replace(/[.:]/g, '_')}`);
    return queued;
  }

  /**
   * Enqueue a message for a subscriber with backpressure handling.
   * Uses tail-drop: drops the oldest message if queue is full.
   *
   * @returns true if message was queued, false if dropped
   */
  private enqueue(state: SubscriberState, message: QueuedMessage): boolean {
    // Check WebSocket state - don't queue for closed/closing connections
    if (state.ws.readyState !== state.ws.OPEN) {
      return false;
    }

    // Backpressure: if queue is full, drop the oldest message (tail-drop)
    if (state.queue.length >= this.config.maxQueueDepth) {
      state.queue.shift(); // Remove oldest
      state.dropped++;
      metrics.increment('gateway.broadcast.dropped');
    }

    state.queue.push(message);

    // Warn if queue is getting deep (indicates slow client)
    if (state.queue.length === this.config.queueWarnThreshold) {
      logWarn('[BroadcastManager] Queue depth warning:', state.queue.length, 'messages');
      this.emit('queue_warning', { depth: state.queue.length, ws: state.ws });
    }

    return true;
  }

  /**
   * Flush queued messages to subscribers.
   * Called periodically by the flush timer.
   */
  private async flushQueues(): Promise<void> {
    // Prevent concurrent flushes
    if (this.flushing) return;
    this.flushing = true;

    try {
      const subscribersToFlush: SubscriberState[] = [];

      // Collect subscribers with pending messages
      for (const state of this.subscribers.values()) {
        if (state.queue.length > 0 && !state.sending && state.ws.readyState === state.ws.OPEN) {
          subscribersToFlush.push(state);
        }
      }

      // Process in batches to control concurrency
      for (let i = 0; i < subscribersToFlush.length; i += this.config.maxConcurrentSends) {
        const batch = subscribersToFlush.slice(i, i + this.config.maxConcurrentSends);
        await Promise.all(batch.map((state) => this.flushSubscriber(state)));
      }

      // Update queue depth metrics
      let totalQueued = 0;
      let maxQueueDepth = 0;
      for (const state of this.subscribers.values()) {
        totalQueued += state.queue.length;
        maxQueueDepth = Math.max(maxQueueDepth, state.queue.length);
      }
      metrics.set('gateway.broadcast.queued_total', totalQueued);
      metrics.set('gateway.broadcast.queue_max_depth', maxQueueDepth);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Flush all queued messages for a single subscriber
   */
  private async flushSubscriber(state: SubscriberState): Promise<void> {
    if (state.sending || state.queue.length === 0) return;
    state.sending = true;

    try {
      // Drain the entire queue
      while (state.queue.length > 0) {
        // Check connection state before each send
        if (state.ws.readyState !== state.ws.OPEN) {
          break;
        }

        const message = state.queue.shift()!;

        // Async send with error handling
        try {
          await this.sendAsync(state.ws, message.payload);
          metrics.increment('gateway.broadcast.messages_sent');
        } catch (err) {
          // Connection error - stop flushing this subscriber
          logDebug('[BroadcastManager] Send error, stopping flush');
          break;
        }
      }
    } finally {
      state.sending = false;
    }
  }

  /**
   * Promisified WebSocket send
   */
  private sendAsync(ws: WebSocket, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== ws.OPEN) {
        reject(new Error('WebSocket not open'));
        return;
      }

      ws.send(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Force immediate flush (for testing/shutdown)
   */
  async flush(): Promise<void> {
    await this.flushQueues();
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    subscribers: number;
    totalQueued: number;
    totalDropped: number;
    maxQueueDepth: number;
  } {
    let totalQueued = 0;
    let totalDropped = 0;
    let maxQueueDepth = 0;

    for (const state of this.subscribers.values()) {
      totalQueued += state.queue.length;
      totalDropped += state.dropped;
      maxQueueDepth = Math.max(maxQueueDepth, state.queue.length);
    }

    return {
      subscribers: this.subscribers.size,
      totalQueued,
      totalDropped,
      maxQueueDepth,
    };
  }

  /**
   * Clean up and release resources
   */
  destroy(): void {
    this.stop();
    this.subscribers.clear();
    this.removeAllListeners();
  }
}
