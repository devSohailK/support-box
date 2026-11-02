import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { TicketCounts } from '@support-box/shared';
import { api } from '../api';
import { tickCount } from './motion';
import { useToast } from './Toast';

const REFRESH_MS = 10_000;

// zeroAt changes each time my actionable tickets drop to zero (the inbox-zero moment).
type CountsState = { counts: TicketCounts | null; refresh: () => void; zeroAt: number };

const CountsContext = createContext<CountsState>({ counts: null, refresh: () => undefined, zeroAt: 0 });

/** Sidebar badge counts, refreshed every 10s while the tab is visible and after any action. */
export function CountsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [counts, setCounts] = useState<TicketCounts | null>(null);
  const [zeroAt, setZeroAt] = useState(0);
  const lastActionable = useRef<number | null>(null);

  const refresh = useCallback(() => {
    api<TicketCounts>('/tickets/counts')
      .then((c) => {
        // Only a drop from something to nothing counts; opening the app at zero doesn't.
        if (lastActionable.current !== null && lastActionable.current > 0 && c.mineActionable === 0) {
          setZeroAt(Date.now());
          toast('All caught up. Nothing waiting on you.', { celebrate: true });
        }
        lastActionable.current = c.mineActionable;
        setCounts(c);
      })
      .catch(() => undefined);
  }, [toast]);

  useEffect(() => {
    refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  return <CountsContext.Provider value={{ counts, refresh, zeroAt }}>{children}</CountsContext.Provider>;
}

export const useCounts = () => useContext(CountsContext);

/** A number that rolls to its new value instead of jumping. React renders it once; GSAP updates it. */
export function AnimatedCount({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [initial] = useState(value);
  const shown = useRef(value);
  useLayoutEffect(() => {
    if (!ref.current) return;
    tickCount(ref.current, shown.current, value);
    shown.current = value;
  }, [value]);
  return (
    <span ref={ref} className="count-num">
      {initial}
    </span>
  );
}
