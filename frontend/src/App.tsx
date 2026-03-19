import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { useAuthStore } from "@/store/auth";
import { authApi } from "@/api/auth";

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

/** Silently logs in as admin if no session exists, then renders the app. */
function AutoAuthProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, setTokens, setUser } = useAuthStore();
  const [ready, setReady] = useState(isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) { setReady(true); return; }
    authApi.login("sear_admin", "SearLab@2024")
      .then((tokens) => {
        setTokens(tokens.access_token, tokens.refresh_token);
        return authApi.getMe();
      })
      .then((user) => { setUser(user); setReady(true); })
      .catch(() => setReady(true)); // fall through even on error
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AutoAuthProvider>
          <Routes>
            {/* Login & register redirect straight to dashboard */}
            <Route path="/login"    element={<Navigate to="/dashboard" replace />} />
            <Route path="/register" element={<Navigate to="/dashboard" replace />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard"       element={<Dashboard />} />
              <Route path="inventory"       element={<Inventory />} />
              <Route path="inventory/:id"   element={<ItemDetail />} />
              <Route path="scan"            element={<Scan />} />
              <Route path="transactions"    element={<Transactions />} />
              <Route path="locations"       element={<Locations />} />
              <Route path="import"          element={<Import />} />
              <Route path="alerts"          element={<Alerts />} />
              <Route path="ai"              element={<AiInsights />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AutoAuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
