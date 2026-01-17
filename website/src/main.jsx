import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Log app startup for debugging
console.log('[APP] main.jsx starting');

// Font loading detection
if ('fonts' in document) {
  document.fonts.ready.then(() => {
    document.body.classList.add('fonts-loaded');
    console.log('[APP] Fonts loaded');
  });
} else {
  // Fallback for older browsers
  document.body.classList.add('fonts-loaded');
}

// Top-level error fallback for catastrophic failures
const CriticalErrorFallback = (
  <div style={{
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0f',
    color: '#ff6b6b',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '20px',
    textAlign: 'center'
  }}>
    <div style={{ maxWidth: '500px' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Application Failed to Load</h1>
      <p style={{ marginBottom: '16px', color: '#888' }}>
        A critical error occurred during startup. Check the browser console for details.
      </p>
      <button
        onClick={() => {
          localStorage.clear();
          sessionStorage.clear();
          window.location.reload();
        }}
        style={{
          padding: '12px 24px',
          backgroundColor: '#333',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          marginRight: '8px'
        }}
      >
        Clear Storage & Reload
      </button>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '12px 24px',
          backgroundColor: '#444',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer'
        }}
      >
        Reload
      </button>
    </div>
  </div>
);

console.log('[APP] Rendering root component');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fallback={CriticalErrorFallback}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

console.log('[APP] Root component rendered');
