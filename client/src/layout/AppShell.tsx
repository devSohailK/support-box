import { AlarmClock, Archive, Check, Inbox, LogOut, Plus, UserRound } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { TicketCounts } from '@support-box/shared';
import { useAuth } from '../auth';
import { Avatar } from '../ui/Avatar';
import { AnimatedCount, useCounts } from '../ui/counts';
import { wobble } from '../ui/motion';

type View = {
  label: string;
  to: string;
  icon: typeof Inbox;
  count: (c: TicketCounts) => number;
  // Which list query this view represents, for the active state.
  matches: (p: URLSearchParams) => boolean;
  alert?: boolean;
  // Show a check mark at zero instead of hiding the badge (inbox zero).
  zeroCheck?: boolean;
};

const VIEWS: View[] = [
  {
    label: 'My tickets',
    to: '/?mine=true',
    icon: UserRound,
    // What's waiting on me (Needs reply or AI failed), not everything I own.
    count: (c) => c.mineActionable,
    matches: (p) => p.get('mine') === 'true',
    zeroCheck: true,
  },
  {
    label: 'All tickets',
    to: '/',
    icon: Inbox,
    count: (c) => c.all - c.closed,
    matches: (p) => !p.get('mine') && !p.get('overdue') && p.get('status') !== 'closed',
  },
  {
    label: 'Overdue',
    to: '/?overdue=true',
    icon: AlarmClock,
    count: (c) => c.overdue,
    matches: (p) => p.get('overdue') === 'true' && !p.get('mine'),
    alert: true,
  },
  {
    label: 'Closed',
    to: '/?status=closed',
    icon: Archive,
    count: (c) => c.closed,
    matches: (p) => p.get('status') === 'closed' && !p.get('mine'),
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { counts, zeroAt } = useCounts();
  const zeroRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (zeroAt) wobble(zeroRef.current);
  }, [zeroAt]);
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const onList = location.pathname === '/';

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/?mine=true" className="brand" aria-label="Support Inbox, my tickets">
          <span className="brand-mark" aria-hidden="true">
            <Inbox size={18} strokeWidth={2.4} />
          </span>
          <span className="brand-name">Support Inbox</span>
        </Link>

        <Link to="/tickets/new" className="btn sidebar-new">
          <Plus size={22} aria-hidden="true" />
          <span className="sidebar-new-label">New ticket</span>
        </Link>

        <nav className="views" aria-label="Ticket views">
          {VIEWS.map((v) => {
            const active = onList && v.matches(params);
            const n = counts ? v.count(counts) : null;
            const Icon = v.icon;
            return (
              <Link
                key={v.label}
                to={v.to}
                className={`view state-layer${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="view-label">{v.label}</span>
                {n !== null && n > 0 && (
                  <span className={`view-count${v.alert ? ' is-alert' : ''}${v.zeroCheck ? ' is-mine' : ''}`}>
                    <AnimatedCount value={n} />
                    <span className="visually-hidden">{v.zeroCheck ? ' waiting on you' : ' tickets'}</span>
                  </span>
                )}
                {n === 0 && v.zeroCheck && (
                  <span className="view-zero" ref={zeroRef} title="Nothing waiting on you">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                    <span className="visually-hidden">Nothing waiting on you</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="account">
            <Avatar name={user.name} seed={user.email} size={36} />
            <div className="account-who">
              <div className="account-name">{user.name}</div>
              <div className="account-role">{user.role === 'admin' ? 'Admin' : 'Agent'}</div>
            </div>
            <button className="btn btn-ghost icon-btn" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>

      <main className="content" id="main">
        {children}
      </main>
    </div>
  );
}
