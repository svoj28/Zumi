import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Applies only the latest value once per frame. Gesture events can arrive faster than React can
 * render; without this, every event triggers a full store update and re-render, the JS thread
 * falls behind and the value visibly lags the finger. `flush` applies a pending value at once
 * (e.g. when the drag ends).
 */
export function useFrameThrottle<T>(apply: (value: T) => void): { push: (value: T) => void; flush: () => void } {
  const applyRef = useRef(apply);
  useLayoutEffect(() => {
    applyRef.current = apply;
  });

  const [api] = useState(() => {
    let frame: number | null = null;
    let queued: { value: T } | null = null;
    const flush = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const next = queued;
      queued = null;
      if (next) applyRef.current(next.value);
    };
    const push = (value: T) => {
      queued = { value };
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    return { push, flush };
  });

  useEffect(() => api.flush, [api]);
  return api;
}
