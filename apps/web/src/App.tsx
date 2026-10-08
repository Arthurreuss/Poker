// Routen der App (WP-014). Übersicht: docs/ARCHITECTURE.md, Abschnitt „Frontend“.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthContext';
import { RedirectIfAuthenticated, RequireAdmin, RequireAuth } from './auth/guards';
import { AppShell } from './layout/AppShell';
import { AdminPage } from './pages/AdminPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LobbyPage } from './pages/LobbyPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { TablePage } from './pages/TablePage';

// Testseite der Tischansicht (WP-016) – nur im Dev-Build, landet nicht im Prod-Bundle.
const TableDevPage = import.meta.env.DEV
  ? lazy(() => import('./table/dev/TableDevPage').then((m) => ({ default: m.TableDevPage })))
  : null;
// Tisch per WebSocket anlegen, solange es keine Lobby gibt (WP-018) – ebenfalls nur im Dev-Build.
const DevNewTablePage = import.meta.env.DEV
  ? lazy(() => import('./game/dev/DevNewTablePage').then((m) => ({ default: m.DevNewTablePage })))
  : null;

/** Alle Routen ohne Router – Tests betten sie in einen `MemoryRouter`. */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfAuthenticated>
            <RegisterPage />
          </RedirectIfAuthenticated>
        }
      />
      {TableDevPage && (
        <Route
          path="/dev/table"
          element={
            <Suspense fallback={null}>
              <TableDevPage />
            </Suspense>
          }
        />
      )}
      {DevNewTablePage && (
        <Route
          path="/dev/new-table"
          element={
            <RequireAuth>
              <Suspense fallback={null}>
                <DevNewTablePage />
              </Suspense>
            </RequireAuth>
          }
        />
      )}
      {/* Tisch ohne App-Shell: volle Fläche, eigenes Tisch-Menü (WP-016/017/018). */}
      <Route
        path="/table/:id"
        element={
          <RequireAuth>
            <TablePage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<LobbyPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="admin/*"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
