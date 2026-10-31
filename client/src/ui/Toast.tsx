import { CheckCircle2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; message: string };

const ToastContext = createContext<(message: string) => void>(() => undefined);

/** Short confirmations of completed actions ("Reply sent"). Errors stay inline, next to their cause. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (message: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, message }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
