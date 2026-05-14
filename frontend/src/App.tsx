import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, lazy, Suspense } from "react";
import { authApi } from "@/api/auth";
import { Layout } from "@/components/layout/Layout";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { SkeletonApp } from "@/components/ui/Skeleton";

// ── Lazy-loaded pages (code-splitting for fast initial load) ──────────────────
const Dashboard     = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Inventory     = lazy(() => import("@/pages/Inventory").then((m) => ({ default: m.Inventory })));
const ItemDetail    = lazy(() => import("@/pages/ItemDetail").then((m) => ({ default: m.ItemDetail })));
const Scan          = lazy(() => import("@/pages/Scan").then((m) => ({ default: m.Scan })));
const Transactions  = lazy(() => import("@/pages/Transactions").then((m) => ({ default: m.Transactions })));
const Locations     = lazy(() => import("@/pages/Locations").then((m) => ({ default: m.Locations })));
const Import        = lazy(() => import("@/pages/Import").then((m) => ({ default: m.Import })));
const Alerts        = lazy(() => import("@/pages/Alerts").then((m) => ({ default: m.Alerts })));
const AiInsights    = lazy(() => import("@/pages/AiInsights").then((m) => ({ default: m.AiInsights })));
const AiCopilot     = lazy(() => import("@/pages/AiCopilot").then((m) => ({ default: m.AiCopilot })));
const SmartScan     = lazy(() => import("@/pages/SmartScan"));
const RfidScan      = lazy(() => import("@/pages/RfidScan"));
const Settings      = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })));
const Admin         = lazy(() => import("@/pages/Admin").then((m) => ({ default: m.Admin })));
const EnergyDashboard = lazy(() => import("@/pages/EnergyDashboard").then((m) => ({ default: m.EnergyDashboard })));
const Login         = lazy(() => import("@/pages/Login").then((m) => ({ default: m.Login })));
const Register      = lazy(() => import("@/pages/Register").then((m) => ({ default: m.Register })));
const VerifyEmail   = lazy(() => import("@/pages/VerifyEmail").then((m) => ({ default: m.VerifyEmail })));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const Landing       = lazy(() => import("@/pages/Landing").then((m) => ({ default: m.Landing })));

// ── Query client ──────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
    },
  },
});

// ── Page-level loading fallback ───────────────────────────────────────────────

function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
    </div>
  );
}

/**
 * Waits for Zustand persist rehydration, then validates stored JWT against the API.
 * Avoids showing the app as logged-in when tokens are expired or from an old deploy.
 */
function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const waitHydration = () =>
      new Promise<void>((resolve) => {
        if (useAuthStore.persist.hasHydrated()) {
          resolve();
          return;
        }
        const unsub = useAuthStore.persist.onFinishHydration(() => {
          unsub();
          resolve();
        });
      });

    void (async () => {
      await waitHydration();
      const { accessToken, logout, setUser } = useAuthStore.getState();
      if (accessToken) {
        try {
          const user = await authApi.getMe();
          if (!cancelled) setUser(user);
        } catch (e: unknown) {
          // Do not wipe the session on network / gateway errors (Render cold start, timeouts).
          const status = (e as { response?: { status?: number } })?.response?.status;
          if (!cancelled && (status === 401 || status === 403)) {
            logout();
          }
        }
      }
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <SkeletonApp />;
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    // Mobile: show cinematic landing page; desktop: go straight to login
    const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;
    return <Navigate to={isMobile ? "/welcome" : "/login"} replace />;
  }
  return <>{children}</>;
}

function ThemeInit() {
  const apply = useThemeStore((s) => s.apply);
  useEffect(() => { apply(); }, [apply]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeInit />
        <AuthBootstrap>
          <Suspense fallback={<SkeletonApp />}>
            <Routes>
              <Route path="/welcome" element={<Suspense fallback={<SkeletonApp />}><Landing /></Suspense>} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route
                path="/"
                element={(
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                )}
              >
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Suspense fallback={<PageSpinner />}><Dashboard /></Suspense>} />
                <Route path="inventory" element={<Suspense fallback={<PageSpinner />}><Inventory /></Suspense>} />
                <Route path="inventory/:id" element={<Suspense fallback={<PageSpinner />}><ItemDetail /></Suspense>} />
                <Route path="scan" element={<Suspense fallback={<PageSpinner />}><Scan /></Suspense>} />
                <Route path="transactions" element={<Suspense fallback={<PageSpinner />}><Transactions /></Suspense>} />
                <Route path="locations" element={<Suspense fallback={<PageSpinner />}><Locations /></Suspense>} />
                <Route path="import" element={<Suspense fallback={<PageSpinner />}><Import /></Suspense>} />
                <Route path="alerts" element={<Suspense fallback={<PageSpinner />}><Alerts /></Suspense>} />
                <Route path="ai" element={<Suspense fallback={<PageSpinner />}><AiInsights /></Suspense>} />
                <Route path="copilot" element={<Suspense fallback={<PageSpinner />}><AiCopilot /></Suspense>} />
                <Route path="smart-scan" element={<Suspense fallback={<PageSpinner />}><SmartScan /></Suspense>} />
                <Route path="rfid-scan" element={<Suspense fallback={<PageSpinner />}><RfidScan /></Suspense>} />
                <Route path="settings" element={<Suspense fallback={<PageSpinner />}><Settings /></Suspense>} />
                <Route path="users" element={<Suspense fallback={<PageSpinner />}><Admin /></Suspense>} />
                <Route path="energy" element={<Suspense fallback={<PageSpinner />}><EnergyDashboard /></Suspense>} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthBootstrap>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
