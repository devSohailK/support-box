import { CheckCircle2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { wobble } from './motion';

type ToastOptions = { celebrate?: boolean };
type Toast = { id: number; message: string; celebrate: boolean };

const ToastContext = createContext<(message: string, options?: ToastOptions) => void>(() => undefined);

/** Short confirmations of completed actions ("Reply sent"). Errors stay inline, next to their cause. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, message, celebrate: Boolean(options.celebrate) }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { celebrate } = toast;
  useEffect(() => {
    if (celebrate) wobble(ref.current);
  }, [celebrate]);
  return (
    <div ref={ref} className={`toast${celebrate ? ' is-celebrate' : ''}`}>
      <CheckCircle2 size={18} aria-hidden="true" />
      <span>{toast.message}</span>
      <button className="toast-close state-layer" onClick={onDismiss} aria-label="Dismiss">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
