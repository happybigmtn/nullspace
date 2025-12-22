/// <reference lib="webworker" />

export type PhysicsWorkerRequest =
  | { type: 'ping'; id?: string }
  | { type: 'step'; id: string; payload?: Record<string, unknown> };

export type PhysicsWorkerResponse =
  | { type: 'pong'; id?: string; ts: number }
  | { type: 'stepResult'; id: string; ok: boolean };

self.addEventListener('message', (event: MessageEvent<PhysicsWorkerRequest>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ping') {
    const response: PhysicsWorkerResponse = {
      type: 'pong',
      id: message.id,
      ts: performance.now(),
    };
    self.postMessage(response);
    return;
  }

  if (message.type === 'step') {
    const response: PhysicsWorkerResponse = {
      type: 'stepResult',
      id: message.id,
      ok: false,
    };
    self.postMessage(response);
  }
});
