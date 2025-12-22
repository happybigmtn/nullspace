import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../../services/telemetry';

export type FeedbackRating = 'positive' | 'negative';

const FEEDBACK_COUNT_KEY = 'casino-3d-feedback-count';
const FEEDBACK_DONE_KEY = 'casino-3d-feedback-done';
const FEEDBACK_THRESHOLD = 3;

const readCount = (raw: string | null) => {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const use3DFeedbackPrompt = (game: string, active: boolean) => {
  const [show, setShow] = useState(false);
  const countRef = useRef<number>(
    typeof window === 'undefined' ? 0 : readCount(localStorage.getItem(FEEDBACK_COUNT_KEY))
  );
  const lastKeyRef = useRef<string | null>(null);

  const markAnimationComplete = useCallback((key: string | number) => {
    if (typeof window === 'undefined') return;
    const nextKey = String(key);
    if (lastKeyRef.current === nextKey) return;
    lastKeyRef.current = nextKey;
    countRef.current += 1;
    localStorage.setItem(FEEDBACK_COUNT_KEY, String(countRef.current));
  }, []);

  const submit = useCallback((rating: FeedbackRating) => {
    track('casino.3d.feedback', { game, rating });
    if (typeof window !== 'undefined') {
      localStorage.setItem(FEEDBACK_DONE_KEY, '1');
    }
    setShow(false);
  }, [game]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FEEDBACK_DONE_KEY, '1');
    }
    setShow(false);
  }, []);

  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(FEEDBACK_DONE_KEY) === '1') return;
    if (countRef.current >= FEEDBACK_THRESHOLD) {
      setShow(true);
    }
  }, [active]);

  return {
    show,
    markAnimationComplete,
    submit,
    dismiss,
  };
};

export default use3DFeedbackPrompt;
