import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional name for this boundary to identify in logs */
  name?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const boundaryName = this.props.name || 'unnamed';
    console.error(`[ErrorBoundary:${boundaryName}] Caught error:`, error);
    console.error(`[ErrorBoundary:${boundaryName}] Error message:`, error.message);
    console.error(`[ErrorBoundary:${boundaryName}] Error stack:`, error.stack);
    console.error(`[ErrorBoundary:${boundaryName}] Component stack:`, errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      // If a custom fallback is provided, use it
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default visible error display
      return (
        <div style={{
          padding: '20px',
          margin: '20px',
          backgroundColor: '#1a0a0a',
          border: '2px solid #ff6b6b',
          borderRadius: '8px',
          color: '#ff6b6b',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <h2 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
            ⚠️ Error {this.props.name ? `in ${this.props.name}` : ''}
          </h2>
          <p style={{ margin: '0 0 8px 0', color: '#fff' }}>
            Something went wrong. Your game state is safe on-chain.
          </p>
          <p style={{
            margin: '0 0 16px 0',
            fontSize: '14px',
            color: '#ff9999',
            fontFamily: 'monospace',
            padding: '8px',
            backgroundColor: 'rgba(255, 107, 107, 0.1)',
            borderRadius: '4px'
          }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          {this.state.error?.stack && (
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', color: '#888', fontSize: '12px' }}>
                Stack trace (click to expand)
              </summary>
              <pre style={{
                fontSize: '10px',
                color: '#666',
                maxHeight: '150px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                padding: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '4px',
                marginTop: '8px'
              }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
          {this.state.errorInfo?.componentStack && (
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', color: '#888', fontSize: '12px' }}>
                Component stack (click to expand)
              </summary>
              <pre style={{
                fontSize: '10px',
                color: '#666',
                maxHeight: '150px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                padding: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '4px',
                marginTop: '8px'
              }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                backgroundColor: '#333',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Reload Page
            </button>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: undefined, errorInfo: undefined })}
              style={{
                padding: '8px 16px',
                backgroundColor: '#222',
                color: '#fff',
                border: '1px solid #444',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#441111',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Clear Storage & Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
