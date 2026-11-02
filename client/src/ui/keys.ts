import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Single-key shortcuts never fire while typing, inside a dialog, or with a modifier held. */
function ignore(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    e.defaultPrevented ||
    !t ||
    t.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) ||
    Boolean(t.closest('dialog'))
  );
}

/** j/k move focus through the ticket rows; Enter on a focused row opens it (it's a link). */
export function useListKeys(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignore(e) || (e.key !== 'j' && e.key !== 'k')) return;
      const rows = Array.from(root.current?.querySelectorAll<HTMLElement>('a.ticket-row') ?? []);
      if (rows.length === 0) return;
      e.preventDefault();
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const next = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === 'j' ? 1 : -1)));
      rows[next]!.focus();
      rows[next]!.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [root]);
}

/** Ticket page: e focuses the reply, Esc goes back (Esc inside the reply just leaves the field). */
export function useTicketKeys(handlers: { onEdit: () => void; onBack: () => void }) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && t?.tagName === 'TEXTAREA') return t.blur();
      if (ignore(e)) return;
      if (e.key === 'e') {
        e.preventDefault();
        latest.current.onEdit();
      } else if (e.key === 'Escape') {
        latest.current.onBack();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
