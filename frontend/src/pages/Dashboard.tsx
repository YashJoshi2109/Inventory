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
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { clsx } from "clsx";
import type { InventoryEvent } from "@/types";
import { animationVariants } from "@/utils/animations";
import { energyApi } from "@/api/energy";
import { Sun, TrendingUp } from "lucide-react";

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
  {
    key: "total_inventory_value",
    title: "Inventory Value",
    icon: Activity,
    accent: "#a78bfa",
    bgClass: "stat-card-violet",
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

function EcoEnergyWidget() {
  const { data: energy, isLoading } = useQuery({
    queryKey: ["dashboard-energy-widget"],
    queryFn: () => energyApi.getDashboard(12),
    refetchInterval: 15_000,
  });
  const navigate = useNavigate();

  if (isLoading || !energy) {
    return <SkeletonCard rows={5} />;
  }

  const { latest, stats, history } = energy;
  if (!latest) return null;

  // Format chart data (last 20 points to fit nicely)
  const chartData = history.labels.map((label, idx) => ({
    time: new Date(label).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    solar: history.solar[idx] || 0,
    consumption: (history.ac[idx] || 0) + (history.hwh[idx] || 0) + (history.consumption[idx] || 0),
  })).slice(-20);

  const isSurplus = stats.savings_status === "SURPLUS";

  return (
    <motion.div
      variants={animationVariants.fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      className="col-span-1 lg:col-span-3 rounded-3xl overflow-hidden relative cursor-pointer hover:shadow-2xl transition-all duration-300"
      onClick={() => navigate("/energy")}
      style={{
        background: "linear-gradient(145deg, rgba(7,15,31,0.8) 0%, rgba(15,23,42,0.9) 100%)",
        border: "1px solid rgba(34,211,238,0.15)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="absolute top-0 right-0 w-64 h-64 blur-3xl opacity-10 rounded-full transition-colors duration-1000" style={{ background: isSurplus ? "#34d399" : "#f87171" }} />
      
      <div className="p-6 flex flex-col h-full gap-5 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center animate-pulse-slow" style={{ background: "rgba(34,211,238,0.15)", border: "1px solid rgba(34,211,238,0.3)" }}>
              <Zap size={20} className="text-cyan-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">EcoEnergy Hub</h3>
              <p className="text-[11px] text-cyan-400/80 uppercase tracking-widest font-semibold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /> Live Metrics</p>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 backdrop-blur-md ${isSurplus ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border-red-500/30 text-red-400'}`}>
            {isSurplus ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {stats.savings_status}
          </div>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
            <div className="flex items-center gap-1.5 mb-1 text-amber-400/80">
              <Sun size={12} />
              <p className="text-[11px] font-semibold uppercase tracking-wide">Solar Gen</p>
            </div>
            <p className="text-2xl font-black text-amber-400">{Math.round(latest.solar_current_power_w)}<span className="text-sm text-amber-400/60 ml-1 font-semibold">W</span></p>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
            <div className="flex items-center gap-1.5 mb-1 text-cyan-400/80">
              <Activity size={12} />
              <p className="text-[11px] font-semibold uppercase tracking-wide">Total Load</p>
            </div>
            <p className="text-2xl font-black text-cyan-400">{Math.round(latest.total_consumption_w)}<span className="text-sm text-cyan-400/60 ml-1 font-semibold">W</span></p>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
            <div className="flex items-center gap-1.5 mb-1 text-indigo-400/80">
              <Zap size={12} />
              <p className="text-[11px] font-semibold uppercase tracking-wide">HVAC Use</p>
            </div>
            <p className="text-2xl font-black text-indigo-400">{Math.round(latest.ac_consumption_w)}<span className="text-sm text-indigo-400/60 ml-1 font-semibold">W</span></p>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
            <div className="flex items-center gap-1.5 mb-1 text-rose-400/80">
              <Activity size={12} />
              <p className="text-[11px] font-semibold uppercase tracking-wide">Heater Use</p>
            </div>
            <p className="text-2xl font-black text-rose-400">{Math.round(latest.hwh_consumption_w)}<span className="text-sm text-rose-400/60 ml-1 font-semibold">W</span></p>
          </div>
        </div>

        {/* Miniature Animated Area Chart */}
        <div className="flex-1 mt-2 min-h-[160px] w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="solarGradMain" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="consGradMain" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} tickMargin={10} minTickGap={30} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
              <Tooltip 
                contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "12px", fontSize: "12px", backdropFilter: "blur(16px)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}
                itemStyle={{ color: "#e2e8f0", fontWeight: 'bold' }}
                cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area type="monotone" dataKey="solar" stroke="#fbbf24" strokeWidth={2.5} fillOpacity={1} fill="url(#solarGradMain)" name="Solar Gen (W)" isAnimationActive />
              <Area type="monotone" dataKey="consumption" stroke="#22d3ee" strokeWidth={2.5} fillOpacity={1} fill="url(#consGradMain)" name="Usage (W)" isAnimationActive />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  );
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonKpiCard key={i} />)}
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
        className="grid grid-cols-2 lg:grid-cols-5 gap-3"
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
          const formattedValue = key === "total_inventory_value"
            ? `$${Math.round(value ?? 0).toLocaleString()}`
            : value?.toLocaleString() ?? "0";

          return (
            <motion.div key={key} variants={animationVariants.listItem}>
              <KpiCard
                title={title}
                value={formattedValue}
                subtitle={subKey ? subtitle : undefined}
                icon={icon}
                accent={accent}
                bgClass={bgClass}
              />
            </motion.div>
          );
        })}
      </motion.div>

      {/* EcoEnergy Hub Widget */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <EcoEnergyWidget />
      </div>

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
          <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Top Consumed — Last 30 Days</h3>
              <p className="text-xs text-slate-500 mt-0.5">Highest outbound movement by item quantity</p>
            </div>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full"
              style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.22)" }}
            >
              rolling window
            </span>
          </div>
          <div className="px-5 pt-3 pb-4">
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
            <div className="mt-2 flex flex-wrap gap-2">
              {stats.top_consumed.slice(0, 3).map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <span
                    className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee" }}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-xs text-slate-300 max-w-[140px] truncate">{item.name}</span>
                  <span className="text-xs font-semibold text-cyan-300">{item.total_consumed}</span>
                </div>
              ))}
            </div>
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
            <>
              {/* Mobile: show top 5, then route to transactions */}
              <motion.div
                className="lg:hidden"
                variants={animationVariants.staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {stats.recent_activity.slice(0, 5).map((event) => (
                  <motion.div key={event.id} variants={animationVariants.listItem}>
                    <ActivityRow event={event} />
                  </motion.div>
                ))}
                {stats.recent_activity.length > 5 && (
                  <button
                    onClick={() => navigate("/transactions")}
                    className="w-full mt-3 mb-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
                    style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.24)", color: "#22d3ee" }}
                  >
                    Show more activity
                  </button>
                )}
              </motion.div>

              {/* Desktop: full list */}
              <motion.div
                className="hidden lg:block"
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
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
