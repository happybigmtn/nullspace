import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useWebSocketContext } from '../context/WebSocketContext';

export function useWebSocketReconnectOnForeground(): void {
  const { reconnect, connectionState, isReconnecting } = useWebSocketContext();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const connectionStateRef = useRef(connectionState);
  const isReconnectingRef = useRef(isReconnecting);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    isReconnectingRef.current = isReconnecting;
  }, [isReconnecting]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousState = appStateRef.current;
      const wasBackground = previousState === 'background' || previousState === 'inactive';

      if (wasBackground && nextAppState === 'active') {
        // Only trigger reconnect if not already connected AND not already reconnecting
        if (connectionStateRef.current !== 'connected' && !isReconnectingRef.current) {
          reconnect();
        }
      }

      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [reconnect]);
}
