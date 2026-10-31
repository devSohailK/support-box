import { useEffect, useId, useRef, type ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Accessible confirmation built on <dialog>: focus trap, Escape to cancel, focus returns on close. */
export function ConfirmDialog({ open, title, children, confirmLabel, busy, busyLabel = 'Working…', onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel(); // click on the backdrop
      }}
    >
      <div className="dialog-body">
        <h2 id={titleId}>{title}</h2>
        <div className="dialog-content">{children}</div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
