// JS shim for modules that can't import TypeScript directly.
const IS_DEV = Boolean(import.meta.env?.DEV);

const shouldEnableDebug = () => {
  if (IS_DEV) return true;
  if (typeof window === 'undefined') return false;

  // Enable debug logging on testnet hosts
  const hostname = window.location?.hostname ?? '';
  if (hostname.endsWith('testnet.regenesis.dev') || hostname === 'localhost') {
    return true;
  }

  // Enable debug logging when QA mode is active
  try {
    if (localStorage?.getItem('qa_bets_enabled') === 'true') return true;
    if (localStorage?.getItem('qa_allow_legacy') === 'true') return true;
  } catch {
    // ignore
  }

  return false;
};

export const logDebug = (...args) => {
  if (shouldEnableDebug()) {
    // Use console.log with [qa-debug] prefix so Playwright captures it
    console.log('[qa-debug]', ...args);
  }
};
