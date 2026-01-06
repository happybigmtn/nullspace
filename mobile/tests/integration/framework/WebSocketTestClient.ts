/**
 * WebSocket Test Client - Real WebSocket connection for integration tests
 * Connects to actual gateway and provides message sending/receiving
 */

import { TestLogger } from './TestLogger';
import WebSocket from 'ws';

export interface GameMessage {
  type: string;
  [key: string]: unknown;
}

export interface WebSocketTestClientOptions {
  url: string;
  timeout?: number; // ms to wait for messages
  logger: TestLogger;
}

export class WebSocketTestClient {
  private ws: WebSocket | null = null;
  private logger: TestLogger;
  private url: string;
  private timeout: number;
  private messageQueue: GameMessage[] = [];
  private messageHandlers: Map<string, (msg: GameMessage) => void> = new Map();

  constructor(options: WebSocketTestClientOptions) {
    this.url = options.url;
    this.timeout = options.timeout || 60000; // Match gateway test timeout (backend is slow)
    this.logger = options.logger;
  }

  /**
   * Connect to WebSocket gateway
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info(`Connecting to ${this.url}`);

      this.ws = new WebSocket(this.url);

      const connectTimeout = setTimeout(() => {
        this.logger.error('Connection timeout');
        reject(new Error('WebSocket connection timeout'));
      }, this.timeout);

      this.ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.logger.success('WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as GameMessage;
          this.logger.debug('Received message', { type: message.type });

          // Add to queue
          this.messageQueue.push(message);

          // Call type-specific handler if registered
          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message);
          }
        } catch (error) {
          this.logger.error('Failed to parse message', error);
        }
      });

      this.ws.on('error', (error) => {
        this.logger.error('WebSocket error', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        this.logger.warn('WebSocket closed', { code, reason: reason.toString() });
      });
    });
  }

  /**
   * Disconnect from WebSocket
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.logger.info('Disconnecting');
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send a message to the gateway
   */
  send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Cannot send - WebSocket not connected');
      throw new Error('WebSocket not connected');
    }

    this.logger.debug('Sending message', message);
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Wait for a specific message type
   */
  async waitForMessage(
    messageType: string,
    timeoutMs?: number
  ): Promise<GameMessage> {
    const timeout = timeoutMs || this.timeout;
    this.logger.debug(`Waiting for message type: ${messageType}`);

    return new Promise((resolve, reject) => {
      // Check if message is already in queue
      const existingIndex = this.messageQueue.findIndex(
        (msg) => msg.type === messageType
      );
      if (existingIndex !== -1) {
        const message = this.messageQueue[existingIndex]!;
        this.messageQueue.splice(existingIndex, 1);
        this.logger.success(`Found ${messageType} in queue`);
        return resolve(message);
      }

      // Set up handler for new messages
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(messageType);
        this.logger.error(`Timeout waiting for ${messageType}`);
        reject(new Error(`Timeout waiting for message type: ${messageType}`));
      }, timeout);

      const handler = (message: GameMessage) => {
        clearTimeout(timeoutId);
        this.messageHandlers.delete(messageType);
        this.logger.success(`Received ${messageType}`, message);
        resolve(message);
      };

      this.messageHandlers.set(messageType, handler);
    });
  }

  /**
   * Wait for multiple message types (any order)
   */
  async waitForMessages(
    messageTypes: string[],
    timeoutMs?: number
  ): Promise<Map<string, GameMessage>> {
    this.logger.debug(`Waiting for messages: ${messageTypes.join(', ')}`);
    const results = new Map<string, GameMessage>();

    const promises = messageTypes.map((type) =>
      this.waitForMessage(type, timeoutMs).then((msg) => {
        results.set(type, msg);
      })
    );

    await Promise.all(promises);
    return results;
  }

  /**
   * Clear message queue
   */
  clearQueue(): void {
    this.logger.debug(`Clearing ${this.messageQueue.length} queued messages`);
    this.messageQueue = [];
  }

  /**
   * Get current connection state
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Simulate reconnection
   */
  async reconnect(): Promise<void> {
    this.logger.info('Simulating reconnection');
    await this.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s
    await this.connect();
  }
}
