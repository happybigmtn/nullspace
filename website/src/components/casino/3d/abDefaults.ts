import { track } from '../../../services/telemetry';

export type AbBucket = '3d' | '2d';

const AB_BUCKET_KEY = 'casino-3d-ab-bucket';
const AB_BUCKET_TRACKED_KEY = 'casino-3d-ab-bucket-tracked';

export const getAbBucket = (): AbBucket => {
  if (typeof window === 'undefined') return '2d';
  const stored = localStorage.getItem(AB_BUCKET_KEY);
  if (stored === '3d' || stored === '2d') return stored;
  const next: AbBucket = Math.random() < 0.5 ? '3d' : '2d';
  localStorage.setItem(AB_BUCKET_KEY, next);
  return next;
};

export const getInitial3DMode = (storageKey: string) => {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(storageKey);
  if (stored === 'true' || stored === 'false') return stored === 'true';
  return getAbBucket() === '3d';
};

export const trackAbBucket = (game?: string) => {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(AB_BUCKET_TRACKED_KEY) === '1') return;
  const bucket = getAbBucket();
  track('casino.3d.ab_bucket', { bucket, game });
  localStorage.setItem(AB_BUCKET_TRACKED_KEY, '1');
};
