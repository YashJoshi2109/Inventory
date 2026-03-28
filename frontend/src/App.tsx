import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { authApi } from "@/api/auth";
import { Layout } from "@/components/layout/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Inventory } from "@/pages/Inventory";
import { ItemDetail } from "@/pages/ItemDetail";
import { Scan } from "@/pages/Scan";
import { Transactions } from "@/pages/Transactions";
import { Locations } from "@/pages/Locations";
import { Import } from "@/pages/Import";
import { Alerts } from "@/pages/Alerts";
import { AiInsights } from "@/pages/AiInsights";
import { AiCopilot } from "@/pages/AiCopilot";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { useAuthStore } from "@/store/auth";

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
        } catch {
          if (!cancelled) logout();
        }
      }
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-dvh bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
          <p className="text-sm text-slate-500">Starting SEAR Lab...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthBootstrap>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/"
              element={(
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              )}
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="inventory/:id" element={<ItemDetail />} />
              <Route path="scan" element={<Scan />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="locations" element={<Locations />} />
              <Route path="import" element={<Import />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="ai" element={<AiInsights />} />
              <Route path="copilot" element={<AiCopilot />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthBootstrap>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
