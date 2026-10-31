import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth';
import { AppShell } from './layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { NewTicketPage } from './pages/NewTicketPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TicketListPage } from './pages/TicketListPage';
import { CountsProvider } from './ui/counts';
import { ToastProvider } from './ui/Toast';

function Routed() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="boot" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <span className="visually-hidden">Loading</span>
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <CountsProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<TicketListPage />} />
          <Route path="/tickets/new" element={<NewTicketPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
          <Route
            path="*"
            element={
              <div className="empty">
                <h2>This page doesn’t exist</h2>
                <Link to="/" className="btn btn-secondary">
                  Go to all tickets
                </Link>
              </div>
            }
          />
        </Routes>
      </AppShell>
    </CountsProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routed />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
