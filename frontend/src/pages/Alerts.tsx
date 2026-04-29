import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { transactionsApi } from "@/api/transactions";
import { roleRequestApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { SkeletonCard, Skeleton } from "@/components/ui/Skeleton";
import {
  Bell, CheckCircle2, AlertTriangle, XCircle, Info, Package, Clock,
  Search, ShieldCheck, UserCheck, UserX, ChevronRight,
  TrendingDown, Zap, FileWarning, Users, X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import type { Alert, RoleRequest } from "@/types";
import { apiErrorMessage } from "@/utils/apiError";

// ─── Severity config ──────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.28)",
    accent: "#3b82f6",
    badgeBg: "rgba(59,130,246,0.14)",
    label: "Info",
  },
  warning: {
    icon: AlertTriangle,
    color: "#d97706",
    bg: "rgba(217,119,6,0.10)",
    border: "rgba(217,119,6,0.28)",
    accent: "#f59e0b",
    badgeBg: "rgba(217,119,6,0.14)",
    label: "Warning",
  },
  critical: {
    icon: XCircle,
    color: "#dc2626",
    bg: "rgba(220,38,38,0.10)",
    border: "rgba(220,38,38,0.30)",
    accent: "#ef4444",
    badgeBg: "rgba(220,38,38,0.14)",
    label: "Critical",
  },
};

const ALERT_TYPE_ICONS: Record<string, React.ElementType> = {
  low_stock: TrendingDown,
  anomaly: Zap,
  expiry: FileWarning,
};

type Tab = "all" | "inventory" | "role_requests" | "resolved";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tabCount(tab: Tab, activeAlerts: Alert[], roleRequests: RoleRequest[], resolvedAlerts: Alert[]): number | null {
  if (tab === "inventory") return activeAlerts.length;
  if (tab === "role_requests") return roleRequests.length;
  if (tab === "resolved") return resolvedAlerts.length;
  return activeAlerts.length + roleRequests.length;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function Alerts() {
  const qc = useQueryClient();
  const { hasRole, user } = useAuthStore();
  const isManager = hasRole("admin", "manager") || (user?.is_superuser ?? false);

  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [reviewNote, setReviewNote] = useState<Record<number, string>>({});
  const [showReviewNote, setShowReviewNote] = useState<number | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: allAlerts = [], isLoading: alertsLoading, error: alertsError } = useQuery({
    queryKey: ["alerts"],
    queryFn: transactionsApi.getAlerts,
    refetchInterval: 30_000,
    retry: false,
  });

  const { data: roleRequests = [], isLoading: rrLoading } = useQuery({
    queryKey: ["role-requests"],
    queryFn: async () => {
      try {
        return await roleRequestApi.list("pending");
      } catch {
        // Non-critical for the Alerts page; managers can still use inventory alerts.
        return [];
      }
    },
    enabled: isManager,
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: myRoleRequest } = useQuery({
    queryKey: ["my-role-request"],
    queryFn: async () => {
      try {
        return await roleRequestApi.getMy();
      } catch {
        return null;
      }
    },
    enabled: !isManager,
    retry: false,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: transactionsApi.resolveAlert,
    onSuccess: () => {
      toast.success("Alert resolved");
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: () => toast.error("Failed to resolve alert"),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      roleRequestApi.approve(id, note),
    onSuccess: (data) => {
      toast.success(`Approved — ${data.full_name || data.username} is now a Manager`);
      qc.invalidateQueries({ queryKey: ["role-requests"] });
      setShowReviewNote(null);
    },
    onError: () => toast.error("Failed to approve request"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      roleRequestApi.reject(id, note),
    onSuccess: () => {
      toast.success("Request rejected — user notified by email");
      qc.invalidateQueries({ queryKey: ["role-requests"] });
      setShowReviewNote(null);
    },
    onError: () => toast.error("Failed to reject request"),
  });

  // ── Data derived ───────────────────────────────────────────────────────────
  const activeAlerts = allAlerts.filter((a) => !a.is_resolved);
  const resolvedAlerts = allAlerts.filter((a) => a.is_resolved);
  const criticalCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const warningCount = activeAlerts.filter((a) => a.severity === "warning").length;
  const totalBadge = activeAlerts.length + (isManager ? roleRequests.length : 0);

  const q = search.toLowerCase();

  const filteredAlerts = useMemo(() => {
    const source = activeTab === "resolved" ? resolvedAlerts : activeAlerts;
    return source.filter((a) =>
      !q ||
      a.message?.toLowerCase().includes(q) ||
      a.item_sku?.toLowerCase().includes(q) ||
      a.item_name?.toLowerCase().includes(q) ||
      a.alert_type?.toLowerCase().includes(q)
    );
  }, [activeAlerts, resolvedAlerts, activeTab, q]);

  const filteredRoleRequests = useMemo(() =>
    roleRequests.filter((r) =>
      !q ||
      r.full_name?.toLowerCase().includes(q) ||
      r.username?.toLowerCase().includes(q) ||
      r.user_email?.toLowerCase().includes(q) ||
      r.message?.toLowerCase().includes(q)
    ),
  [roleRequests, q]);

  const isLoading = alertsLoading || (isManager && rrLoading);

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 max-w-4xl">
        <Skeleton className="h-6 w-48" rounded="xl" />
        <SkeletonCard rows={5} />
      </div>
    );
  }

  if (alertsError) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6 max-w-4xl">
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.22)",
          }}
        >
          <h2 className="text-base font-semibold text-red-300">Could not load alerts</h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {apiErrorMessage(alertsError, "The alerts service is temporarily unavailable. Please retry.")}
          </p>
          <div>
            <Button
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["alerts"] })}
              leftIcon={<ChevronRight size={12} />}
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType; managerOnly?: boolean }[] = [
    { id: "all", label: "All", icon: Bell },
    { id: "inventory", label: "Inventory", icon: AlertTriangle },
    ...(isManager ? [{ id: "role_requests" as Tab, label: "Role Requests", icon: Users, managerOnly: true }] : []),
    { id: "resolved", label: "Resolved", icon: CheckCircle2 },
  ];

  const showAlerts = activeTab === "all" || activeTab === "inventory" || activeTab === "resolved";
  const showRoleRequests = activeTab === "all" || activeTab === "role_requests";

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-5 animate-fade-in max-w-4xl">

      {/* ── Header ── */}
      <div
        className="rounded-2xl p-4 sm:p-5 flex items-start justify-between gap-4 flex-wrap"
        style={{
          background: "linear-gradient(135deg, rgba(8,145,178,0.14) 0%, rgba(34,211,238,0.06) 45%, rgba(248,113,113,0.08) 100%)",
          border: "1px solid rgba(34,211,238,0.18)",
          backdropFilter: "blur(24px) saturate(1.8)",
        }}
      >
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)" }}>
              <Bell size={15} className="text-brand-400" />
            </div>
            Notifications &amp; Alerts
          </h2>
          <p className="text-xs mt-1 ml-10" style={{ color: "var(--text-muted)" }}>
            {totalBadge === 0
              ? "All clear — no active alerts or pending requests"
              : `${totalBadge} item${totalBadge !== 1 ? "s" : ""} requiring attention`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {criticalCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.22)", color: "#f87171" }}>
              <XCircle size={11} /> {criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
              <AlertTriangle size={11} /> {warningCount} warning{warningCount !== 1 ? "s" : ""}
            </span>
          )}
          {isManager && roleRequests.length > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.22)", color: "#a78bfa" }}>
              <Users size={11} /> {roleRequests.length} role request{roleRequests.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── My pending role request banner (viewers who requested manager) ── */}
      {!isManager && myRoleRequest && myRoleRequest.status === "pending" && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.25)" }}>
            <ShieldCheck size={16} className="text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-purple-300">Manager role request pending</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Your request is under review. You'll receive an email once a manager approves or
              declines it.{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                Submitted {formatDistanceToNow(new Date(myRoleRequest.created_at), { addSuffix: true })}
              </span>
            </p>
          </div>
          <span className="text-[10px] font-bold px-2 py-1 rounded-lg shrink-0"
            style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
            PENDING
          </span>
        </motion.div>
      )}
      {!isManager && myRoleRequest && myRoleRequest.status === "rejected" && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.18)" }}
        >
          <UserX size={18} className="text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-300">Manager role request declined</p>
            {myRoleRequest.review_note && (
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Note: {myRoleRequest.review_note}</p>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Search + Tabs ── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Search */}
        <div className="relative flex-1 w-full sm:max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search alerts..."
            className="w-full pl-8 pr-8 py-2 rounded-xl text-sm placeholder-slate-500 focus:outline-none transition-colors"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors" style={{ color: "var(--text-muted)" }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-xl p-1 flex-wrap"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          {TABS.map(({ id, label, icon: Icon }) => {
            const count = tabCount(id, activeAlerts, roleRequests, resolvedAlerts);
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  activeTab === id ? "" : ""
                )}
                style={activeTab === id ? {
                  color: "var(--text-primary)",
                  background: "rgba(34,211,238,0.1)",
                  border: "1px solid rgba(34,211,238,0.2)",
                } : { border: "1px solid transparent", background: "transparent", color: "var(--text-muted)" }}
              >
                <Icon size={12} />
                {label}
                {count !== null && count > 0 && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center"
                    style={{
                      background: id === "role_requests"
                        ? "rgba(167,139,250,0.2)" : "rgba(239,68,68,0.85)",
                      color: id === "role_requests" ? "#a78bfa" : "white",
                    }}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Role Request cards (managers only) ── */}
      {showRoleRequests && isManager && filteredRoleRequests.length > 0 && (
        <div className="space-y-3">
          {activeTab === "all" && (
            <div className="flex items-center gap-2">
              <Users size={11} className="text-purple-500" />
              <h3 className="text-[10px] font-bold text-purple-600 uppercase tracking-widest">
                Pending Role Requests
              </h3>
              <div className="h-px flex-1" style={{ background: "rgba(167,139,250,0.12)" }} />
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {filteredRoleRequests.map((rr) => (
              <RoleRequestCard
                key={rr.id}
                request={rr}
                reviewNote={reviewNote[rr.id] ?? ""}
                setReviewNote={(v) => setReviewNote((prev) => ({ ...prev, [rr.id]: v }))}
                showNote={showReviewNote === rr.id}
                setShowNote={(show) => setShowReviewNote(show ? rr.id : null)}
                onApprove={(note) => approveMutation.mutate({ id: rr.id, note })}
                onReject={(note) => rejectMutation.mutate({ id: rr.id, note })}
                approving={approveMutation.isPending && (approveMutation.variables as { id: number })?.id === rr.id}
                rejecting={rejectMutation.isPending && (rejectMutation.variables as { id: number })?.id === rr.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Inventory Alerts (active) ── */}
      {showAlerts && activeTab !== "resolved" && (
        <div className="space-y-3">
          {(activeTab === "all") && filteredAlerts.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <AlertTriangle size={11} className="text-amber-600" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                Inventory Alerts
              </h3>
              <div className="h-px flex-1" style={{ background: "var(--border-subtle)" }} />
            </div>
          )}
          {filteredAlerts.length === 0 && activeTab === "inventory" ? (
            <EmptyState message="No active inventory alerts" />
          ) : filteredAlerts.length === 0 && activeTab === "all" && !filteredRoleRequests.length ? (
            <EmptyState message="All clear — nothing requires attention" />
          ) : null}
          <AnimatePresence mode="popLayout">
            {filteredAlerts.map((alert) => (
              <InventoryAlertCard
                key={alert.id}
                alert={alert}
                onResolve={() => resolveMutation.mutate(alert.id)}
                resolving={resolveMutation.isPending && resolveMutation.variables === alert.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Empty state for role-requests-only tab ── */}
      {activeTab === "role_requests" && filteredRoleRequests.length === 0 && (
        <EmptyState message="No pending role requests" />
      )}

      {/* ── Resolved section ── */}
      {activeTab === "resolved" && (
        <div className="space-y-3">
          {filteredAlerts.length === 0 ? (
            <EmptyState message="No resolved alerts yet" />
          ) : (
            filteredAlerts.map((alert) => (
              <InventoryAlertCard key={alert.id} alert={alert} resolved />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 gap-4 rounded-2xl"
      style={{ background: "rgba(52,211,153,0.04)", border: "1px solid rgba(52,211,153,0.08)" }}
    >
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.18)" }}>
        <CheckCircle2 size={26} className="text-emerald-400" />
      </div>
      <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{message}</p>
    </motion.div>
  );
}

// ─── Inventory Alert Card ─────────────────────────────────────────────────────
function InventoryAlertCard({
  alert,
  onResolve,
  resolving,
  resolved,
}: {
  alert: Alert;
  onResolve?: () => void;
  resolving?: boolean;
  resolved?: boolean;
}) {
  const config = SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.warning;
  const SeverityIcon = config.icon;
  const TypeIcon = ALERT_TYPE_ICONS[alert.alert_type] ?? AlertTriangle;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: resolved ? 0.4 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="relative rounded-2xl overflow-hidden group"
      style={{
        background: resolved ? "var(--bg-card)" : `linear-gradient(180deg, ${config.bg}, transparent)`,
        border: `1px solid ${resolved ? "var(--border-card)" : config.border}`,
        boxShadow: resolved ? "none" : `0 4px 20px ${config.bg}`,
      }}
    >
      {!resolved && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: `linear-gradient(to bottom, ${config.accent}, ${config.color}88)` }} />
      )}
      <div className={clsx("flex items-start gap-3.5 p-4", !resolved && "pl-5")}>
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: resolved ? "var(--bg-card)" : config.badgeBg,
            border: `1px solid ${resolved ? "var(--border-subtle)" : config.border}`,
          }}>
          <SeverityIcon size={17} style={{ color: resolved ? "var(--text-muted)" : config.color }} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg"
              style={{
                background: resolved ? "var(--bg-card)" : config.badgeBg,
                color: resolved ? "var(--text-muted)" : config.color,
                border: `1px solid ${resolved ? "transparent" : config.border}`,
              }}>
              {config.label}
            </span>
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <TypeIcon size={10} />
              {alert.alert_type.replace(/_/g, " ")}
            </span>
            {resolved && (
              <span className="text-[10px] flex items-center gap-1 ml-auto" style={{ color: "var(--accent-success)" }}>
                <CheckCircle2 size={9} /> Resolved
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed" style={{ color: resolved ? "var(--text-muted)" : "var(--text-primary)" }}>
            {alert.message}
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {alert.item_sku && (
              <span className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-lg"
                style={{ color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                <Package size={9} /> {alert.item_sku}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              <Clock size={10} />
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>

        {/* Actions */}
        {!resolved && (
          <div className="flex flex-col gap-1.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
            {alert.alert_type === "low_stock" && alert.item_id && (
              <Link
                to={`/inventory/${alert.item_id}`}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.18)", color: "#22d3ee" }}
              >
                <Package size={11} /> Add Stock
                <ChevronRight size={10} />
              </Link>
            )}
            {onResolve && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onResolve}
                loading={resolving}
                leftIcon={<CheckCircle2 size={12} />}
                className="text-[11px] py-1"
              >
                Resolve
              </Button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Role Request Card ────────────────────────────────────────────────────────
function RoleRequestCard({
  request,
  reviewNote,
  setReviewNote,
  showNote,
  setShowNote,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  request: RoleRequest;
  reviewNote: string;
  setReviewNote: (v: string) => void;
  showNote: boolean;
  setShowNote: (v: boolean) => void;
  onApprove: (note?: string) => void;
  onReject: (note?: string) => void;
  approving?: boolean;
  rejecting?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="relative rounded-2xl overflow-hidden group"
      style={{
        background: "linear-gradient(180deg, rgba(167,139,250,0.07), transparent)",
        border: "1px solid rgba(167,139,250,0.2)",
        boxShadow: "0 4px 20px rgba(167,139,250,0.06)",
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: "linear-gradient(to bottom, #a78bfa, #7c3aed88)" }} />

      <div className="flex items-start gap-3.5 p-4 pl-5">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 text-sm font-bold"
          style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa" }}>
          {(request.full_name || request.username || "?")[0].toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg"
              style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
              Manager Request
            </span>
            <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
              <Clock size={10} />
              {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
            </span>
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {request.full_name || request.username}
          </p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {request.username && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-lg" style={{ color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
                @{request.username}
              </span>
            )}
            {request.user_email && (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{request.user_email}</span>
            )}
          </div>
          {request.message && (
            <p className="text-xs mt-2 italic" style={{ color: "var(--text-muted)" }}>"{request.message}"</p>
          )}

          {/* Review note input (expandable) */}
          <AnimatePresence>
            {showNote && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 overflow-hidden"
              >
                <input
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Optional note to user (will be emailed)…"
                  className="w-full px-3 py-2 rounded-xl text-xs focus:outline-none transition-colors"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1.5 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            onClick={() => onApprove(reviewNote || undefined)}
            loading={approving}
            disabled={approving || rejecting}
            leftIcon={<UserCheck size={12} />}
            className="text-[11px] py-1"
            style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399" } as React.CSSProperties}
          >
            Approve
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReject(reviewNote || undefined)}
            loading={rejecting}
            disabled={approving || rejecting}
            leftIcon={<UserX size={12} />}
            className="text-[11px] py-1 text-red-400 hover:text-red-300"
          >
            Reject
          </Button>
          <button
            onClick={() => setShowNote(!showNote)}
            className="text-[10px] transition-colors text-center" style={{ color: "var(--text-muted)" }}
          >
            {showNote ? "Hide note" : "Add note"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
