import { useQuery } from "@tanstack/react-query";
import { type ComponentType } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { dashboardApi } from "@/api/transactions";
import { SkeletonKpiCard, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/store/auth";
import {
  Package, TrendingDown, AlertTriangle,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Activity,
  Zap, QrCode, Plus, Bell, Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { clsx } from "clsx";
import type { InventoryEvent } from "@/types";
import { animationVariants } from "@/utils/animations";

const EVENT_ICONS = {
  STOCK_IN:   { icon: ArrowUpRight,   color: "#22d3ee", bg: "rgba(34,211,238,0.1)" },
  STOCK_OUT:  { icon: ArrowDownRight, color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  TRANSFER:   { icon: ArrowLeftRight, color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  ADJUSTMENT: { icon: Activity,       color: "#c084fc", bg: "rgba(192,132,252,0.1)" },
  CYCLE_COUNT:{ icon: Activity,       color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  IMPORT:     { icon: Package,        color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
};

const KPI_CONFIGS = [
  {
    key: "total_skus",
    title: "Total SKUs",
    icon: Package,
    accent: "#22d3ee",
    bgClass: "stat-card-cyan",
  },
  {
    key: "items_low_stock",
    title: "Low Stock",
    icon: TrendingDown,
    accent: "#fbbf24",
    bgClass: "stat-card-amber",
    subKey: "items_out_of_stock",
    subLabel: "out of stock",
  },
  {
    key: "active_alerts",
    title: "Active Alerts",
    icon: AlertTriangle,
    accent: "#f87171",
    bgClass: "stat-card-red",
  },
  {
    key: "transactions_today",
    title: "Today's Activity",
    icon: Zap,
    accent: "#34d399",
    bgClass: "stat-card-emerald",
    subLabel: "transactions",
  },
];

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent,
  bgClass,
}: {
  title: string;
  value: string;
  subtitle?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ComponentType<any>;
  accent: string;
  bgClass: string;
}) {
  return (
    <motion.div
      variants={animationVariants.scaleIn}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      whileHover={{ y: -4, transition: { duration: 0.3 } }}
      className={clsx("rounded-2xl p-5 relative overflow-hidden transition-all duration-200 card-glow cursor-pointer", bgClass)}
      style={{ backdropFilter: "blur(12px)" }}
    >
      {/* Background glow */}
      <div
        className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 pointer-events-none"
        style={{ background: accent }}
      />

      <div className="flex items-start justify-between relative">
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: `${accent}99` }}>
            {title}
          </p>
          <motion.p 
            className="text-3xl font-bold text-white mt-1 tracking-tight"
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            viewport={{ once: true }}
          >
            {value}
          </motion.p>
          {subtitle && (
            <motion.p 
              className="text-xs mt-1" 
              style={{ color: `${accent}70` }}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              viewport={{ once: true }}
            >
              {subtitle}
            </motion.p>
          )}
        </div>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${accent}20`, border: `1px solid ${accent}30` }}
        >
          <Icon size={20} style={{ color: accent }} />
        </div>
      </div>
    </motion.div>
  );
}

function ActivityRow({ event }: { event: InventoryEvent }) {
  const meta =
    EVENT_ICONS[event.event_kind as keyof typeof EVENT_ICONS] ?? EVENT_ICONS.IMPORT;
  const Icon = meta.icon;
  const isIn = event.event_kind === "STOCK_IN";
  const isOut = event.event_kind === "STOCK_OUT";

  return (
    <div className="flex items-center gap-3 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: meta.bg }}
      >
        <Icon size={14} style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate font-medium">{event.item_name}</p>
        <p className="text-xs text-slate-600 truncate mt-0.5">
          {event.event_kind.replace("_", " ")} ·{" "}
          {event.to_location_code ?? event.from_location_code ?? "—"} ·{" "}
          {event.actor_username ?? "system"}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p
          className="text-sm font-bold"
          style={{ color: isIn ? "#22d3ee" : isOut ? "#f87171" : "#a78bfa" }}
        >
          {isIn ? "+" : isOut ? "−" : "→"}
          {event.quantity}
        </p>
        <p className="text-xs text-slate-600">
          {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

const CHART_COLORS = ["#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#06b6d4"];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function Dashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30_000,
  });
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const firstName = user?.full_name.split(" ")[0] ?? "there";

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-8 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonKpiCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SkeletonCard rows={6} />
          <SkeletonCard rows={6} />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 text-sm">
        Failed to load dashboard
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-8 space-y-5 animate-fade-in">

      {/* ── Welcome banner ── */}
      <motion.div
        variants={animationVariants.fadeInUp}
        initial="hidden"
        animate="visible"
        className="rounded-2xl overflow-hidden relative"
        style={{
          background: "linear-gradient(135deg, rgba(8,145,178,0.22) 0%, rgba(34,211,238,0.1) 45%, rgba(167,139,250,0.12) 100%)",
          border: "1px solid rgba(34,211,238,0.2)",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* ambient orbs */}
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-20" style={{ background: "#22d3ee" }} />
        <div className="absolute -bottom-8 left-8 w-32 h-32 rounded-full blur-3xl pointer-events-none opacity-10" style={{ background: "#a78bfa" }} />

        <div className="relative px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={14} className="text-brand-400" />
                <span className="text-xs font-medium text-brand-400 uppercase tracking-wider">{getGreeting()}</span>
              </div>
              <h1 className="text-xl font-bold text-white">{firstName} 👋</h1>
              <p className="text-sm text-slate-400 mt-0.5">
                {stats
                  ? stats.active_alerts > 0
                    ? `${stats.active_alerts} alert${stats.active_alerts > 1 ? "s" : ""} need attention · ${stats.transactions_today} transaction${stats.transactions_today !== 1 ? "s" : ""} today`
                    : `All systems nominal · ${stats.transactions_today} transaction${stats.transactions_today !== 1 ? "s" : ""} today`
                  : "Loading lab status…"}
              </p>
            </div>
            {/* status dot */}
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-medium">Live</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mt-4 flex-wrap">
            {[
              { label: "Scan QR", icon: QrCode, to: "/scan", accent: "#22d3ee" },
              { label: "Add Item", icon: Plus, to: "/inventory", accent: "#34d399" },
              { label: "Alerts", icon: Bell, to: "/alerts", accent: "#f87171", badge: stats?.active_alerts },
            ].map(({ label, icon: Icon, to, accent, badge }) => (
              <button
                key={to}
                onClick={() => navigate(to)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                style={{
                  background: `${accent}18`,
                  border: `1px solid ${accent}30`,
                  color: accent,
                }}
              >
                <Icon size={13} />
                {label}
                {badge != null && badge > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: accent }}>
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* KPI row */}
      <motion.div 
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        variants={animationVariants.staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {KPI_CONFIGS.map(({ key, title, icon, accent, bgClass, subKey, subLabel }) => {
          const value = (stats as unknown as Record<string, number>)[key];
          const subValue = subKey ? (stats as unknown as Record<string, number>)[subKey] : undefined;
          const subtitle =
            subKey && subValue !== undefined
              ? `${subValue} ${subLabel}`
              : subLabel
              ? `${value} ${subLabel}`
              : undefined;

          return (
            <motion.div key={key} variants={animationVariants.listItem}>
              <KpiCard
                title={title}
                value={value?.toLocaleString() ?? "0"}
                subtitle={subKey ? subtitle : undefined}
                icon={icon}
                accent={accent}
                bgClass={bgClass}
              />
            </motion.div>
          );
        })}
      </motion.div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Category donut */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "rgba(7,15,31,0.6)",
            border: "1px solid rgba(255,255,255,0.07)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 className="text-sm font-semibold text-slate-200">Category Distribution</h3>
          </div>
          <div className="px-3 py-3">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={stats.category_breakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={54}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="count"
                  nameKey="name"
                  label={({ percent }) =>
                    percent > 0.07 ? `${(percent * 100).toFixed(0)}%` : ""
                  }
                  labelLine={false}
                >
                  {stats.category_breakdown.map((entry, index) => (
                    <Cell
                      key={entry.id}
                      fill={entry.color ?? CHART_COLORS[index % CHART_COLORS.length]}
                      stroke="transparent"
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload as { name: string; count: number; id: number; color?: string };
                    const total = stats.category_breakdown.reduce((s, c) => s + c.count, 0);
                    const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                    const idx = stats.category_breakdown.findIndex((c) => c.id === d.id);
                    const color = d.color ?? CHART_COLORS[idx % CHART_COLORS.length];
                    return (
                      <div
                        className="px-3 py-2.5 rounded-xl"
                        style={{
                          background: "rgba(7,15,31,0.97)",
                          border: `1px solid ${color}50`,
                          backdropFilter: "blur(16px)",
                          boxShadow: `0 0 20px ${color}20`,
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-sm font-semibold text-white">{d.name}</span>
                        </div>
                        <p className="text-xs text-slate-400">
                          <span className="text-white font-bold">{d.count}</span> items &nbsp;·&nbsp;
                          <span style={{ color }}>{pct}%</span> of total
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Legend grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-2 pb-2">
              {stats.category_breakdown.slice(0, 8).map((cat, i) => (
                <div key={cat.id} className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: cat.color ?? CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="text-xs text-slate-500 truncate">{cat.name}</span>
                  <span className="text-xs text-slate-600 ml-auto shrink-0">{cat.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top consumed bar chart */}
        <div
          className="lg:col-span-2 rounded-2xl overflow-hidden"
          style={{
            background: "rgba(7,15,31,0.6)",
            border: "1px solid rgba(255,255,255,0.07)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 className="text-sm font-semibold text-slate-200">Top Consumed — Last 30 Days</h3>
          </div>
          <div className="px-5 py-3">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.top_consumed} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "#475569", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={105}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickFormatter={(v: string) => (v.length > 15 ? v.slice(0, 15) + "…" : v)}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(7,15,31,0.97)",
                    border: "1px solid rgba(34,211,238,0.25)",
                    borderRadius: "12px",
                    fontSize: "12px",
                    color: "#e2e8f0",
                    backdropFilter: "blur(16px)",
                    boxShadow: "0 0 20px rgba(34,211,238,0.1)",
                  }}
                  formatter={(value: number) => [value, "Consumed"]}
                  labelStyle={{ color: "#94a3b8", marginBottom: "4px" }}
                />
                <Bar
                  dataKey="total_consumed"
                  radius={[0, 6, 6, 0]}
                  maxBarSize={18}
                  fill="url(#barGradient)"
                />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#0891b2" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={1} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <motion.div
        variants={animationVariants.fadeInUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        className="rounded-2xl overflow-hidden"
        style={{
          background: "rgba(7,15,31,0.6)",
          border: "1px solid rgba(255,255,255,0.07)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <h3 className="text-sm font-semibold text-slate-200">Recent Activity</h3>
          <span
            className="text-xs font-medium px-2.5 py-1 rounded-full"
            style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.2)" }}
          >
            {stats.transactions_this_week} this week
          </span>
        </div>

        <div className="px-5">
          {stats.recent_activity.length === 0 ? (
            <div className="py-10 text-center">
              <Activity size={32} className="text-slate-700 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No recent activity</p>
            </div>
          ) : (
            <motion.div
              variants={animationVariants.staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {stats.recent_activity.map((event) => (
                <motion.div key={event.id} variants={animationVariants.listItem}>
                  <ActivityRow event={event} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
