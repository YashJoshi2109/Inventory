
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";
import { Button } from "@/components/ui/Button";
import { SkeletonCard, Skeleton } from "@/components/ui/Skeleton";
import {
  Bell, CheckCircle2, AlertTriangle, XCircle, Info, Package, Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import type { Alert } from "@/types";

const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.07)",
    border: "rgba(96,165,250,0.18)",
    accent: "#3b82f6",
    badgeBg: "rgba(96,165,250,0.1)",
    label: "Info",
  },
  warning: {
    icon: AlertTriangle,
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.07)",
    border: "rgba(251,191,36,0.18)",
    accent: "#f59e0b",
    badgeBg: "rgba(251,191,36,0.1)",
    label: "Warning",
  },
  critical: {
    icon: XCircle,
    color: "#f87171",
    bg: "rgba(248,113,113,0.09)",
    border: "rgba(248,113,113,0.24)",
    accent: "#ef4444",
    badgeBg: "rgba(248,113,113,0.1)",
    label: "Critical",
  },
};

export function Alerts() {
  const qc = useQueryClient();

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: transactionsApi.getAlerts,
    refetchInterval: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: transactionsApi.resolveAlert,
    onSuccess: () => {
      toast.success("Alert resolved");
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  const active = alerts?.filter((a) => !a.is_resolved) ?? [];
  const resolved = alerts?.filter((a) => a.is_resolved) ?? [];
  const criticalCount = active.filter((a) => a.severity === "critical").length;
  const warningCount = active.filter((a) => a.severity === "warning").length;

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" rounded="xl" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <SkeletonCard rows={5} />
        <SkeletonCard rows={3} />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-6 animate-fade-in max-w-3xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)" }}>
              <Bell size={15} className="text-brand-400" />
            </div>
            Alerts
          </h2>
          <p className="text-xs text-slate-500 mt-1 ml-10">
            {active.length === 0
              ? "All clear — no active alerts"
              : `${active.length} active alert${active.length !== 1 ? "s" : ""} requiring attention`}
          </p>
        </div>

        {active.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {criticalCount > 0 && (
              <span
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
                style={{
                  background: "rgba(248,113,113,0.1)",
                  border: "1px solid rgba(248,113,113,0.22)",
                  color: "#f87171",
                }}
              >
                <XCircle size={11} />
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
                style={{
                  background: "rgba(251,191,36,0.1)",
                  border: "1px solid rgba(251,191,36,0.2)",
                  color: "#fbbf24",
                }}
              >
                <AlertTriangle size={11} />
                {warningCount} warning{warningCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Active alerts */}
      {active.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-20 gap-4 rounded-2xl"
          style={{ background: "rgba(52,211,153,0.04)", border: "1px solid rgba(52,211,153,0.1)" }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)" }}
          >
            <CheckCircle2 size={30} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <p className="text-slate-200 font-semibold">All systems nominal</p>
            <p className="text-slate-500 text-sm mt-1">No active alerts at this time</p>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {active.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onResolve={() => resolveMutation.mutate(alert.id)}
                resolving={resolveMutation.isPending && resolveMutation.variables === alert.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Resolved section */}
      {resolved.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mt-2">
            <CheckCircle2 size={12} className="text-slate-700" />
            <h3 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              Resolved
            </h3>
            <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.05)" }} />
          </div>
          <div className="space-y-2">
            {resolved.slice(0, 5).map((alert) => (
              <AlertCard key={alert.id} alert={alert} resolved />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertCard({
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
  const config = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.warning;
  const Icon = config.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: resolved ? 0.45 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="relative rounded-2xl overflow-hidden group"
      style={{
        background: resolved ? "rgba(255,255,255,0.02)" : config.bg,
        border: `1px solid ${resolved ? "rgba(255,255,255,0.05)" : config.border}`,
        boxShadow: resolved ? "none" : `0 4px 24px ${config.bg}`,
      }}
    >
      {/* Left accent bar */}
      {!resolved && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: `linear-gradient(to bottom, ${config.accent}, ${config.color}88)` }}
        />
      )}

      <div className={clsx("flex items-start gap-3.5 p-4", !resolved && "pl-5")}>
        {/* Icon */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: resolved ? "rgba(255,255,255,0.03)" : config.badgeBg,
            border: `1px solid ${resolved ? "rgba(255,255,255,0.06)" : config.border}`,
          }}
        >
          <Icon size={17} style={{ color: resolved ? "#334155" : config.color }} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          {/* Top row: severity + type */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg"
              style={{
                background: resolved ? "rgba(255,255,255,0.04)" : config.badgeBg,
                color: resolved ? "#334155" : config.color,
                border: `1px solid ${resolved ? "transparent" : config.border}`,
              }}
            >
              {config.label}
            </span>
            <span className="text-[10px] text-slate-600 capitalize">
              {alert.alert_type.replace(/_/g, " ")}
            </span>
            {resolved && (
              <span className="text-[10px] text-emerald-700 flex items-center gap-1 ml-auto">
                <CheckCircle2 size={9} /> Resolved
              </span>
            )}
          </div>

          {/* Message */}
          <p className={clsx("text-sm leading-relaxed", resolved ? "text-slate-600" : "text-slate-200")}>
            {alert.message}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {alert.item_sku && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-slate-600 bg-white/[0.03] px-2 py-0.5 rounded-lg border border-white/[0.05]">
                <Package size={9} />
                {alert.item_sku}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] text-slate-600">
              <Clock size={10} />
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>

        {/* Resolve button */}
        {!resolved && onResolve && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onResolve}
            loading={resolving}
            leftIcon={<CheckCircle2 size={13} />}
            className="shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
          >
            Resolve
          </Button>
        )}
      </div>
    </motion.div>
  );
}
