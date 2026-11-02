import { Check, ChevronLeft, ChevronRight, Clock, Coffee, Inbox, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { TicketPage, TicketStatus } from '@support-box/shared';
import { api } from '../api';
import { Avatar } from '../ui/Avatar';
import { CATEGORY_LABELS, STATUS_LABELS, StatusPill, UrgencyPill } from '../ui/Badges';
import { AnimatedCount, useCounts } from '../ui/counts';
import { useListKeys } from '../ui/keys';
import { enterRows, flashRow, leaveRow, slideIndicator, wobble } from '../ui/motion';
import { RelativeTime } from '../ui/time';

const REFRESH_MS = 10_000;

// Tabs shown inside a view; "closed" has its own view in the sidebar.
const STATUS_TABS: (TicketStatus | '')[] = ['', 'open', 'new', 'ai_error', 'replied'];

// Last page seen per query, so coming back from a ticket shows the list at once (no skeleton flash)
// and the row you just handled can leave the list in place.
const cache = new Map<string, TicketPage>();

/** Set by the ticket page after a send or close: which ticket should leave the list. */
export type ListReturnState = { leaving?: number };

function viewTitle(p: URLSearchParams) {
  if (p.get('mine') === 'true') return { title: 'My tickets', sub: 'Assigned to you and not closed yet.' };
  if (p.get('status') === 'closed') return { title: 'Closed', sub: 'Finished tickets, newest first.' };
  if (p.get('overdue') === 'true') return { title: 'Overdue', sub: 'Older than 24 hours with no reply yet.' };
  return { title: 'All tickets', sub: 'Everything in the shared inbox.' };
}

export function TicketListPage() {
  // Filters live in the URL so they survive reloads and the back button.
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const status = params.get('status') ?? '';
  const overdue = params.get('overdue') === 'true';
  const mine = params.get('mine') === 'true';
  const isClosedView = status === 'closed';
  const query = params.toString();

  const [data, setData] = useState<TicketPage | null>(() => cache.get(query) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const { counts, zeroAt } = useCounts();
  const pageRef = useRef<HTMLDivElement>(null);
  // Which query the shown data belongs to, and the ticket ids already on screen for it.
  const dataQuery = useRef(cache.has(query) ? query : '');
  const seen = useRef<{ query: string; ids: Set<number> } | null>(null);
  // Consumed once per visit: the ticket that was just sent or closed.
  const [leaving] = useState(() => (location.state as ListReturnState | null)?.leaving ?? null);
  const leavingRef = useRef(leaving);
  const pendingFocus = useRef<number | null>(null);

  useListKeys(pageRef);

  // Don't replay the leave animation on reload or back/forward.
  useEffect(() => {
    if (leaving !== null) navigate({ search: location.search }, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Near-live updates: re-fetch every 10s while the tab is visible, and as soon as it becomes visible.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<TicketPage>(`/tickets?${query}`)
      .then((d) => {
        if (cancelled) return;
        const show = () => {
          if (cancelled) return;
          cache.set(query, d);
          dataQuery.current = query;
          setData(d);
          setError(null);
        };
        const id = leavingRef.current;
        leavingRef.current = null;
        if (id === null) return show();

        // Focus lands where the handled ticket was, so the next one is under the cursor.
        const items = cache.get(query)?.items ?? [];
        const oldIndex = items.findIndex((t) => t.id === id);
        const li = pageRef.current?.querySelector<HTMLElement>(`[data-ticket-id="${id}"]`);
        const stays = d.items.some((t) => t.id === id);
        if (stays) {
          pendingFocus.current = d.items.findIndex((t) => t.id === id) + 1;
          show();
          flashRow(pageRef.current?.querySelector<HTMLElement>(`[data-ticket-id="${id}"] .ticket-row`) ?? null);
        } else {
          pendingFocus.current = Math.max(0, oldIndex);
          if (li) leaveRow(li, show);
          else show();
        }
      })
      .catch(() => !cancelled && setError('Tickets couldn’t be loaded. Check your connection; this page retries every 10 seconds.'));
    return () => {
      cancelled = true;
    };
  }, [query, tick]);

  // Animate only tickets that weren't on screen before in this same view. The first load of a view
  // (and every 10s refresh that brings nothing new) renders without motion.
  useLayoutEffect(() => {
    if (!data) return;
    const ids = data.items.map((t) => t.id);
    const prev = seen.current;
    seen.current = { query: dataQuery.current, ids: new Set(ids) };

    const root = pageRef.current;
    if (pendingFocus.current !== null) {
      const rows = root?.querySelectorAll<HTMLElement>('.ticket-row');
      if (rows?.length) rows[Math.min(pendingFocus.current, rows.length - 1)]?.focus();
      pendingFocus.current = null;
    }
    if (!prev || prev.query !== dataQuery.current) return;
    const fresh = ids.filter((id) => !prev.ids.has(id));
    enterRows(fresh.flatMap((id) => root?.querySelector(`[data-ticket-id="${id}"]`) ?? []));
  }, [data]);

  // Inbox zero: once the empty state is on screen, it settles in with a wobble.
  const wobbledAt = useRef(0);
  useLayoutEffect(() => {
    if (!zeroAt || wobbledAt.current === zeroAt || Date.now() - zeroAt > 5000) return;
    const icon = pageRef.current?.querySelector('.empty:not(.is-filtered) .empty-icon') ?? null;
    if (!icon) return;
    wobbledAt.current = zeroAt;
    wobble(icon);
  }, [zeroAt, data]);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page'); // filters reset paging
    setParams(next);
  }

  const { title, sub } = viewTitle(params);
  const filtered = Boolean(status || overdue);

  return (
    <div className="page" ref={pageRef}>
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="page-sub">{sub}</p>
        </div>
        {!isClosedView && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(e) => update({ overdue: e.target.checked ? 'true' : null })}
            />
            Only overdue
          </label>
        )}
      </header>

      {!isClosedView && (
        <StatusTabs status={status} counts={!mine && !overdue ? counts : null} onPick={(s) => update({ status: s || null })} />
      )}

      {error && (
        <div className="alert alert-danger list-alert" role="alert">
          <RefreshCw size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!data && !error && <ListSkeleton />}

      {data && data.items.length === 0 && <EmptyState mine={mine} filtered={filtered} />}

      {data && data.items.length > 0 && (
        <>
          <ul className="ticket-list" aria-label={title}>
            {data.items.map((t) => (
              <li key={t.id} data-ticket-id={t.id}>
                <Link
                  to={`/tickets/${t.id}`}
                  state={{ from: query }}
                  className={`ticket-row state-layer${t.overdue ? ' is-overdue' : ''}`}
                >
                  <span className="ticket-urgency">
                    <UrgencyPill urgency={t.urgency} />
                  </span>
                  <span className="ticket-main">
                    <span className="ticket-subject">{t.subject}</span>
                    <span className="ticket-from">
                      {t.fromName || t.fromEmail}
                      <span className="ticket-id">#{t.id}</span>
                    </span>
                  </span>
                  <span className="ticket-category">
                    {t.category ? (
                      CATEGORY_LABELS[t.category]
                    ) : t.automated ? (
                      <span title="Auto-reply, bounce or no-reply sender; no AI draft">Automated</span>
                    ) : null}
                  </span>
                  <span className="ticket-status">
                    <StatusPill status={t.status} />
                  </span>
                  <span className="ticket-owner" title={`Assigned to ${t.assignee.name}`}>
                    <Avatar name={t.assignee.name} size={22} />
                    <span className="visually-hidden">Assigned to {t.assignee.name}</span>
                  </span>
                  <span className="ticket-time" title={t.overdue ? 'Older than 24 hours with no reply' : undefined}>
                    {t.overdue && <Clock size={13} strokeWidth={2.5} aria-hidden="true" />}
                    <RelativeTime iso={t.createdAt} />
                    {t.overdue && <span className="visually-hidden">, overdue</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="list-foot">
            <span className="kbd-hint muted xs">
              <kbd>J</kbd> <kbd>K</kbd> to move, <kbd>Enter</kbd> to open
            </span>
            {data.totalPages > 1 && (
              <nav className="pager" aria-label="Pages">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={data.page <= 1}
                  onClick={() => update({ page: String(data.page - 1) })}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous
                </button>
                <span className="muted small">
                  Page {data.page} of {data.totalPages}, {data.total} tickets
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => update({ page: String(data.page + 1) })}
                >
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </nav>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Segmented status filter; the active background slides between tabs. */
function StatusTabs({
  status,
  counts,
  onPick,
}: {
  status: string;
  counts: Record<string, number> | null;
  onPick: (s: TicketStatus | '') => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const lastStatus = useRef<string | null>(null);

  useLayoutEffect(() => {
    const place = (animate: boolean) => {
      const active = barRef.current?.querySelector<HTMLElement>('.tab.is-active');
      if (active && indicatorRef.current) slideIndicator(indicatorRef.current, active, animate);
    };
    // Slide only when the user picks another tab; count changes and resizes just re-measure.
    place(lastStatus.current !== null && lastStatus.current !== status);
    lastStatus.current = status;
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [status, counts]);

  return (
    <div className="tabs" role="group" aria-label="Filter by status" ref={barRef}>
      <span className="tab-indicator" ref={indicatorRef} aria-hidden="true" />
      {STATUS_TABS.map((s) => {
        const active = status === s;
        const n = s && counts ? counts[s] : null;
        return (
          <button
            key={s || 'all'}
            className={`tab state-layer${active ? ' is-active' : ''}`}
            aria-pressed={active}
            onClick={() => onPick(s)}
          >
            {active && <Check size={16} strokeWidth={2.5} aria-hidden="true" />}
            {s ? STATUS_LABELS[s] : 'Any status'}
            {n != null && n > 0 && (
              <span className="tab-count">
                <AnimatedCount value={n} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="ticket-list" aria-busy="true" aria-label="Fetching the latest tickets...">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i}>
          <div className="ticket-row is-skeleton">
            <span className="ticket-urgency">
              <span className="skeleton" style={{ width: 48, height: 18 }} />
            </span>
            <span className="ticket-main">
              <span className="skeleton" style={{ width: `${55 - (i % 3) * 10}%`, height: 14 }} />
              <span className="skeleton" style={{ width: '25%', height: 10, marginTop: 6 }} />
            </span>
            <span className="ticket-category">
              <span className="skeleton" style={{ width: 64, height: 12 }} />
            </span>
            <span className="ticket-status">
              <span className="skeleton" style={{ width: 84, height: 20 }} />
            </span>
            <span className="ticket-owner">
              <span className="skeleton" style={{ width: 22, height: 22, borderRadius: '50%' }} />
            </span>
            <span className="ticket-time">
              <span className="skeleton" style={{ width: 40, height: 12 }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ mine, filtered }: { mine: boolean; filtered: boolean }) {
  if (filtered) {
    return (
      <div className="empty is-filtered">
        <span className="empty-icon">
          <Inbox size={24} aria-hidden="true" />
        </span>
        <h2>No tickets match these filters</h2>
        <p className="muted">Choose another status, or clear the overdue filter.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <span className="empty-icon">
        <Coffee size={24} aria-hidden="true" />
      </span>
      <h2>All caught up. Nothing waiting.</h2>
      <p className="muted">
        {mine
          ? 'Time for a coffee. New tickets are assigned automatically and land here.'
          : 'Enjoy the quiet. Emails to the support address show up here within a minute.'}
      </p>
      <Link to="/tickets/new" className="btn btn-secondary">
        <Plus size={16} aria-hidden="true" />
        Log a ticket by hand
      </Link>
    </div>
  );
}
