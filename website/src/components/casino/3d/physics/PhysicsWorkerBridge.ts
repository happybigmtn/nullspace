import type { PhysicsWorkerRequest, PhysicsWorkerResponse } from './physicsWorker';

export type PhysicsWorkerHandle = {
  worker: Worker;
  postMessage: (message: PhysicsWorkerRequest) => void;
  terminate: () => void;
};

export const createPhysicsWorker = (): PhysicsWorkerHandle | null => {
  if (typeof Worker === 'undefined') return null;
  const worker = new Worker(new URL('./physicsWorker.ts', import.meta.url), {
    type: 'module',
  });

  return {
    worker,
    postMessage: (message: PhysicsWorkerRequest) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
};

export const addPhysicsWorkerListener = (
  handle: PhysicsWorkerHandle,
  listener: (message: PhysicsWorkerResponse) => void
) => {
  handle.worker.addEventListener('message', (event: MessageEvent<PhysicsWorkerResponse>) => {
    listener(event.data);
  });
};
