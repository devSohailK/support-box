import { ChevronLeft, ChevronRight, Coffee, Inbox, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { TicketPage, TicketStatus } from '@support-box/shared';
import { api } from '../api';
import { Avatar } from '../ui/Avatar';
import { CategoryTag, OverduePill, STATUS_LABELS, StatusPill, UrgencyPill } from '../ui/Badges';
import { useCounts } from '../ui/counts';
import { enterRows, wobble } from '../ui/motion';
import { RelativeTime } from '../ui/time';

const REFRESH_MS = 10_000;

// Tabs shown inside a view; "closed" has its own view in the sidebar.
const STATUS_TABS: (TicketStatus | '')[] = ['', 'open', 'new', 'ai_error', 'replied'];

function viewTitle(p: URLSearchParams) {
  if (p.get('mine') === 'true') return { title: 'My tickets', sub: 'Assigned to you and not closed yet.' };
  if (p.get('status') === 'closed') return { title: 'Closed', sub: 'Finished tickets, newest first.' };
  if (p.get('overdue') === 'true') return { title: 'Overdue', sub: 'Older than 24 hours with no reply yet.' };
  return { title: 'All tickets', sub: 'Everything in the shared inbox.' };
}

export function TicketListPage() {
  // Filters live in the URL so they survive reloads and the back button.
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const overdue = params.get('overdue') === 'true';
  const mine = params.get('mine') === 'true';
  const isClosedView = status === 'closed';

  const [data, setData] = useState<TicketPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const { counts } = useCounts();
  const pageRef = useRef<HTMLDivElement>(null);
  // Which query the shown data belongs to, and the ticket ids already on screen for it.
  const dataQuery = useRef('');
  const seen = useRef<{ query: string; ids: Set<number> } | null>(null);

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

  const query = params.toString();
  useEffect(() => {
    let cancelled = false;
    api<TicketPage>(`/tickets?${query}`)
      .then((d) => {
        if (!cancelled) {
          dataQuery.current = query;
          setData(d);
          setError(null);
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
    if (!prev || prev.query !== dataQuery.current) return;

    const root = pageRef.current;
    const fresh = ids.filter((id) => !prev.ids.has(id));
    enterRows(fresh.flatMap((id) => root?.querySelector(`[data-ticket-id="${id}"]`) ?? []));
    // The view just went from something to nothing: a small celebration.
    if (prev.ids.size > 0 && ids.length === 0) wobble(root?.querySelector('.empty:not(.is-filtered) .empty-icon') ?? null);
  }, [data]);

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
        <div className="tabs" role="group" aria-label="Filter by status">
          {STATUS_TABS.map((s) => {
            const active = status === s;
            const n = s && counts && !mine && !overdue ? counts[s] : null;
            return (
              <button
                key={s || 'all'}
                className={`tab${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => update({ status: s || null })}
              >
                {s ? STATUS_LABELS[s] : 'Any status'}
                {n !== null && n > 0 && <span className="tab-count">{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="alert alert-danger list-alert" role="alert">
          <RefreshCw size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!data && !error && <ListSkeleton />}

      {data && data.items.length === 0 && <EmptyState mine={mine} filtered={Boolean(status || overdue)} />}

      {data && data.items.length > 0 && (
        <>
          <ul className="ticket-list" aria-label={title}>
            {data.items.map((t) => (
              <li key={t.id} data-ticket-id={t.id}>
                <Link to={`/tickets/${t.id}`} className={`ticket-row${t.overdue ? ' is-overdue' : ''}`}>
                  <Avatar name={t.fromName || t.fromEmail} seed={t.fromEmail} size={32} />
                  <div className="ticket-main">
                    <div className="ticket-subject">{t.subject}</div>
                    <div className="ticket-from">
                      {t.fromName || t.fromEmail}
                      <span className="ticket-id">#{t.id}</span>
                    </div>
                  </div>
                  <div className="ticket-tags">
                    {t.overdue && <OverduePill />}
                    <UrgencyPill urgency={t.urgency} />
                    <CategoryTag category={t.category} />
                    {t.automated && (
                      <span className="tag" title="Auto-reply, bounce or no-reply sender; no AI draft">
                        Automated
                      </span>
                    )}
                  </div>
                  <div className="ticket-status">
                    <StatusPill status={t.status} />
                  </div>
                  <div className="ticket-meta">
                    <span className="ticket-assignee" title={`Assigned to ${t.assignee.name}`}>
                      <Avatar name={t.assignee.name} size={22} />
                      <span className="visually-hidden">Assigned to {t.assignee.name}</span>
                    </span>
                    <span className="ticket-time">
                      <RelativeTime iso={t.createdAt} />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

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
        </>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="ticket-list" aria-busy="true" aria-label="Fetching the latest tickets...">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="ticket-row is-skeleton">
          <span className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%' }} />
          <div className="ticket-main">
            <span className="skeleton" style={{ width: '60%', height: 14 }} />
            <span className="skeleton" style={{ width: '30%', height: 10, marginTop: 6 }} />
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
          <Inbox size={26} aria-hidden="true" />
        </span>
        <h2>No tickets match these filters</h2>
        <p className="muted">Choose another status, or clear the overdue filter.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <span className="empty-icon">
        <Coffee size={26} aria-hidden="true" />
      </span>
      <h2>All caught up. Nothing waiting.</h2>
      <p className="muted">
        {mine
          ? 'Time for a coffee. New tickets are assigned automatically and land here.'
          : 'Enjoy the quiet. Emails to the support address show up here within a minute.'}
      </p>
      <Link to="/tickets/new" className="btn btn-secondary">
        <Plus size={18} aria-hidden="true" />
        Log a ticket by hand
      </Link>
    </div>
  );
}
