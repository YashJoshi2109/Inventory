import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Bell, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import type { Alert } from "@/types";

const SEVERITY_CONFIG = {
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", badgeVariant: "info" as const },
  warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", badgeVariant: "warning" as const },
  critical: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", badgeVariant: "danger" as const },
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

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-6 animate-fade-in max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Alerts</h2>
          <p className="text-xs text-slate-500">{active.length} active alerts</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : active.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={40} className="text-emerald-400" />}
          title="All clear"
          description="No active alerts at this time"
        />
      ) : (
        <Card>
          <div className="divide-y divide-surface-border/50">
            {active.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onResolve={() => resolveMutation.mutate(alert.id)}
                resolving={resolveMutation.isPending && resolveMutation.variables === alert.id}
              />
            ))}
          </div>
        </Card>
      )}

      {resolved.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Recently Resolved</h3>
          <Card>
            <div className="divide-y divide-surface-border/50">
              {resolved.slice(0, 5).map((alert) => (
                <AlertRow key={alert.id} alert={alert} resolved />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alert, onResolve, resolving, resolved,
}: {
  alert: Alert;
  onResolve?: () => void;
  resolving?: boolean;
  resolved?: boolean;
}) {
  const config = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.warning;
  const Icon = config.icon;

  return (
    <div className={clsx("flex items-start gap-3 px-4 py-4", resolved && "opacity-50")}>
      <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5", config.bg)}>
        <Icon size={15} className={config.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={config.badgeVariant} className="text-xs capitalize">{alert.severity}</Badge>
          <Badge variant="default" className="text-xs">{alert.alert_type.replace(/_/g, " ")}</Badge>
        </div>
        <p className="text-sm text-slate-200 mt-1">{alert.message}</p>
        {alert.item_sku && (
          <p className="text-xs text-slate-500 mt-0.5 font-mono">{alert.item_sku}</p>
        )}
        <p className="text-xs text-slate-500 mt-1">
          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
        </p>
      </div>
      {!resolved && onResolve && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onResolve}
          loading={resolving}
          leftIcon={<CheckCircle2 size={13} />}
        >
          Resolve
        </Button>
      )}
    </div>
  );
}
