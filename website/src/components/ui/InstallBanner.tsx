import React from 'react';
import { usePWA } from '../../hooks/usePWA';

/**
 * PWA Install Banner (US-157)
 *
 * Shows a dismissible banner prompting users to install the app.
 * - On Chrome/Edge: Shows native install prompt
 * - On iOS Safari: Shows manual instructions
 * - Automatically hides after user dismisses (for 7 days)
 */
export function InstallBanner() {
  const { canInstall, promptInstall, isIOSSafari, dismissBanner, isDismissed, isInstalled } = usePWA();

  // Don't show if already installed or dismissed
  if (isInstalled || isDismissed) return null;

  // Show iOS-specific instructions
  if (isIOSSafari) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-titanium-900 border-t border-titanium-700 animate-in slide-in-from-bottom duration-300">
        <div className="max-w-md mx-auto flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-titanium-100 mb-1">
              Install null/space
            </p>
            <p className="text-xs text-titanium-400">
              Tap <span className="inline-flex items-center px-1 py-0.5 rounded bg-titanium-800 text-titanium-200">
                <ShareIcon className="w-3 h-3 mr-1" />
                Share
              </span> then <span className="font-medium text-titanium-200">"Add to Home Screen"</span>
            </p>
          </div>
          <button
            onClick={dismissBanner}
            className="p-2 text-titanium-500 hover:text-titanium-300 transition-colors"
            aria-label="Dismiss"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Show install prompt for Chrome/Edge
  if (canInstall) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-titanium-900 border-t border-titanium-700 animate-in slide-in-from-bottom duration-300">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-titanium-100 mb-0.5">
              Install null/space
            </p>
            <p className="text-xs text-titanium-400">
              Add to your home screen for quick access
            </p>
          </div>
          <button
            onClick={promptInstall}
            className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-white text-titanium-900 rounded hover:bg-titanium-100 transition-colors"
          >
            Install
          </button>
          <button
            onClick={dismissBanner}
            className="p-2 text-titanium-500 hover:text-titanium-300 transition-colors"
            aria-label="Dismiss"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}
