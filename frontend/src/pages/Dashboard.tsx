import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/api/transactions";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import {
  Package, TrendingDown, AlertTriangle, DollarSign,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Activity,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { clsx } from "clsx";
import type { InventoryEvent } from "@/types";

const EVENT_ICONS = {
  STOCK_IN: { icon: ArrowUpRight, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  STOCK_OUT: { icon: ArrowDownRight, color: "text-red-400", bg: "bg-red-500/10" },
  TRANSFER: { icon: ArrowLeftRight, color: "text-blue-400", bg: "bg-blue-500/10" },
  ADJUSTMENT: { icon: Activity, color: "text-purple-400", bg: "bg-purple-500/10" },
  CYCLE_COUNT: { icon: Activity, color: "text-slate-400", bg: "bg-slate-500/10" },
  IMPORT: { icon: Package, color: "text-amber-400", bg: "bg-amber-500/10" },
};

function KpiCard({
  title, value, subtitle, icon: Icon, color, trend,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  trend?: { value: number; label: string };
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-slate-400 font-medium">{title}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          {trend && (
            <p className={clsx("text-xs mt-1 font-medium", trend.value > 0 ? "text-emerald-400" : "text-red-400")}>
              {trend.value > 0 ? "↑" : "↓"} {Math.abs(trend.value)} {trend.label}
            </p>
          )}
        </div>
        <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center", color)}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </Card>
  );
}

function ActivityRow({ event }: { event: InventoryEvent }) {
  const meta = EVENT_ICONS[event.event_kind] ?? EVENT_ICONS.IMPORT;
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 py-3 border-b border-surface-border/50 last:border-0">
      <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", meta.bg)}>
        <Icon size={14} className={meta.color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate font-medium">
          {event.item_name}
        </p>
        <p className="text-xs text-slate-500 truncate">
          {event.event_kind.replace("_", " ")} •{" "}
          {event.to_location_code ?? event.from_location_code ?? "—"} •{" "}
          {event.actor_username ?? "system"}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={clsx(
          "text-sm font-semibold",
          event.event_kind === "STOCK_IN" ? "text-emerald-400" : "text-red-400"
        )}>
          {event.event_kind === "STOCK_IN" ? "+" : "-"}{event.quantity}
        </p>
        <p className="text-xs text-slate-500">
          {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        Failed to load dashboard
      </div>
    );
  }

  const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-6 animate-fade-in">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <KpiCard
          title="Total SKUs"
          value={stats.total_skus.toLocaleString()}
          icon={Package}
          color="bg-brand-600"
        />
        <KpiCard
          title="Low Stock"
          value={stats.items_low_stock.toString()}
          subtitle={`${stats.items_out_of_stock} out of stock`}
          icon={TrendingDown}
          color="bg-amber-600"
        />
        <KpiCard
          title="Active Alerts"
          value={stats.active_alerts.toString()}
          icon={AlertTriangle}
          color="bg-red-600"
        />
        <KpiCard
          title="Inventory Value"
          value={`$${Number(stats.total_inventory_value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          subtitle={`${stats.transactions_today} transactions today`}
          icon={DollarSign}
          color="bg-emerald-600"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Category distribution */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-200">Category Distribution</h3>
          </CardHeader>
          <CardContent className="py-2">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={stats.category_breakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="count"
                  nameKey="name"
                >
                  {stats.category_breakdown.map((entry, index) => (
                    <Cell
                      key={entry.id}
                      fill={entry.color ?? PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px" }}
                  formatter={(v) => [v, "items"]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 justify-center mt-1">
              {stats.category_breakdown.slice(0, 5).map((cat, i) => (
                <span key={cat.id} className="flex items-center gap-1 text-xs text-slate-400">
                  <span className="w-2 h-2 rounded-full" style={{ background: cat.color ?? PIE_COLORS[i % PIE_COLORS.length] }} />
                  {cat.name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top consumed */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-200">Top Consumed (30d)</h3>
          </CardHeader>
          <CardContent className="py-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.top_consumed} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickFormatter={(v) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px" }}
                />
                <Bar dataKey="total_consumed" fill="#3b82f6" radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Recent Activity</h3>
            <Badge variant="info">{stats.transactions_this_week} this week</Badge>
          </div>
        </CardHeader>
        <CardContent className="py-0 divide-y divide-surface-border/0">
          {stats.recent_activity.length === 0 ? (
            <p className="py-8 text-center text-slate-500 text-sm">No recent activity</p>
          ) : (
            stats.recent_activity.map((event) => (
              <ActivityRow key={event.id} event={event} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
