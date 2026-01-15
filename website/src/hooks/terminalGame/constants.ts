export const BALANCE_UPDATE_COOLDOWN_MS = 2000;
const resolveChainResponseTimeoutMs = () => {
  const base = 15_000;
  // Check environment variable first (works in both SSR and client)
  try {
    const envFlag = String((import.meta as any)?.env?.VITE_QA_BETS ?? '').toLowerCase();
    if (envFlag === 'true' || envFlag === '1') {
      return 60_000;
    }
  } catch {
    // ignore - import.meta may not be available in all contexts
  }
  if (typeof window === 'undefined') return base;
  try {
    const params = new URLSearchParams(window.location.search);
    const qaParam = params.get('qa');
    const qaFlag = qaParam === '1' || qaParam?.toLowerCase() === 'true';
    const storedFlag = localStorage.getItem('qa_bets_enabled') === 'true';
    if (qaFlag || storedFlag) {
      return 60_000;
    }
  } catch {
    // ignore
  }
  return base;
};

export const CHAIN_RESPONSE_TIMEOUT_MS = resolveChainResponseTimeoutMs();
export const PLAYER_SYNC_MIN_INTERVAL_MS = 2000;
