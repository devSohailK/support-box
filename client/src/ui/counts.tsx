import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { TicketCounts } from '@support-box/shared';
import { api } from '../api';

const REFRESH_MS = 10_000;

type CountsState = { counts: TicketCounts | null; refresh: () => void };

const CountsContext = createContext<CountsState>({ counts: null, refresh: () => undefined });

/** Sidebar badge counts, refreshed every 10s while the tab is visible and after any action. */
export function CountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<TicketCounts | null>(null);

  const refresh = useCallback(() => {
    api<TicketCounts>('/tickets/counts')
      .then(setCounts)
      .catch(() => undefined);
  }, []);

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

  return <CountsContext.Provider value={{ counts, refresh }}>{children}</CountsContext.Provider>;
}

export const useCounts = () => useContext(CountsContext);
