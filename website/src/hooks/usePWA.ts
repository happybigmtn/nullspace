import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

interface UsePWAReturn {
  /** Whether the app can be installed (install prompt available) */
  canInstall: boolean;
  /** Whether the app is running in standalone/installed mode */
  isInstalled: boolean;
  /** Trigger the install prompt */
  promptInstall: () => Promise<boolean>;
  /** Whether iOS Safari (manual install instructions needed) */
  isIOSSafari: boolean;
  /** Dismiss the install banner */
  dismissBanner: () => void;
  /** Whether the banner was dismissed */
  isDismissed: boolean;
}

const DISMISSED_KEY = 'pwa-install-dismissed';
const DISMISSED_EXPIRY_DAYS = 7;

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua);
  const isChrome = /CriOS/.test(ua);
  const isFirefox = /FxiOS/.test(ua);
  return isIOS && isWebkit && !isChrome && !isFirefox;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Check for standalone display mode
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari check
  if ((window.navigator as any).standalone === true) return true;
  return false;
}

function isDismissedRecently(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const dismissed = localStorage.getItem(DISMISSED_KEY);
  if (!dismissed) return false;
  const dismissedAt = parseInt(dismissed, 10);
  const expiryMs = DISMISSED_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - dismissedAt < expiryMs;
}

function setDismissed(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DISMISSED_KEY, Date.now().toString());
}

/**
 * Hook for managing PWA install prompt and state
 *
 * Usage:
 * ```tsx
 * const { canInstall, promptInstall, isIOSSafari, dismissBanner, isDismissed } = usePWA();
 *
 * if (canInstall && !isDismissed) {
 *   return <InstallBanner onInstall={promptInstall} onDismiss={dismissBanner} />;
 * }
 *
 * if (isIOSSafari && !isDismissed) {
 *   return <IOSInstallInstructions onDismiss={dismissBanner} />;
 * }
 * ```
 */
export function usePWA(): UsePWAReturn {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    // Check if already installed
    setIsInstalled(isStandalone());
    // Check if dismissed recently
    setIsDismissed(isDismissedRecently());

    // Listen for install prompt
    const handleBeforeInstall = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    // Listen for app installed
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[PWA] Install prompt failed:', error);
      return false;
    }
  }, [deferredPrompt]);

  const dismissBanner = useCallback(() => {
    setDismissed();
    setIsDismissed(true);
  }, []);

  return {
    canInstall: deferredPrompt !== null && !isInstalled,
    isInstalled,
    promptInstall,
    isIOSSafari: isIOSSafari() && !isInstalled,
    dismissBanner,
    isDismissed
  };
}
