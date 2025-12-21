export const MIN_ANIMATION_MS = 3400;
export const COLLAPSE_DELAY_MS = 900;

export const getMinRemainingMs = (startMs: number | null, minMs = MIN_ANIMATION_MS) => {
  if (!startMs) return 0;
  return Math.max(0, minMs - (performance.now() - startMs));
};
