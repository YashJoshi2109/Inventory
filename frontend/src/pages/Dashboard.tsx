import { useQuery } from "@tanstack/react-query";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { motion, animate } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { dashboardApi } from "@/api/transactions";
import { SkeletonKpiCard, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/store/auth";
import {
  Package,
  TrendingDown,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Activity,
  Zap,
  ChevronRight,
  DollarSign,
  TrendingUp,
  Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";
import { clsx } from "clsx";
import type { InventoryEvent } from "@/types";
import { animationVariants } from "@/utils/animations";
import { energyApi } from "@/api/energy";
import { Sun, Droplets, Wind } from "lucide-react";
import { Button } from "@/components/ui/Button";

// ── Event config ─────────────────────────────────────────────────────────────
const EVENT_ICONS = {
  STOCK_IN:    { icon: ArrowUpRight,   color: "var(--accent)",         bg: "rgba(var(--accent-rgb), 0.10)" },
  STOCK_OUT:   { icon: ArrowDownRight, color: "var(--accent-danger)",  bg: "rgba(var(--accent-danger-rgb), 0.10)" },
  TRANSFER:    { icon: ArrowLeftRight, color: "var(--accent-violet)",  bg: "rgba(var(--accent-violet-rgb), 0.10)" },
  ADJUSTMENT:  { icon: Activity,       color: "var(--accent-violet)",  bg: "rgba(var(--accent-violet-rgb), 0.10)" },
  CYCLE_COUNT: { icon: Activity,       color: "var(--text-muted)",     bg: "rgba(148,163,184,0.08)" },
  IMPORT:      { icon: Package,        color: "var(--accent-warning)", bg: "rgba(var(--accent-warning-rgb), 0.10)" },
};

// ── KPI configs (matching design spec) ───────────────────────────────────────
interface KpiConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  key: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ComponentType<any>;
  cssVar: string;
  rgbVar: string;
  bgClass: string;
  trend: number;
  subtitle?: string;
  subKey?: string;
  subLabel?: string;
}

const KPI_CONFIGS: KpiConfig[] = [
  {
    key: "total_skus",
    title: "Total SKUs",
    icon: Package,
    cssVar: "--accent",
    rgbVar: "--accent-rgb",
    bgClass: "stat-card-blue",
    trend: +4.2,
    subtitle: "unique items tracked",
  },
  {
    key: "items_low_stock",
    title: "Low Stock",
    icon: TrendingDown,
    cssVar: "--accent-2",
    rgbVar: "--accent-2-rgb",
    bgClass: "stat-card-orange",
    trend: -2.1,
    subKey: "items_out_of_stock",
    subLabel: "out of stock",
  },
  {
    key: "active_alerts",
    title: "Active Alerts",
    icon: AlertTriangle,
    cssVar: "--accent-danger",
    rgbVar: "--accent-danger-rgb",
    bgClass: "stat-card-red",
    trend: +1.0,
    subtitle: "need attention",
  },
  {
    key: "transactions_today",
    title: "Today's Moves",
    icon: Zap,
    cssVar: "--accent-success",
    rgbVar: "--accent-success-rgb",
    bgClass: "stat-card-green",
    trend: +12.5,
    subtitle: "transactions logged",
  },
  {
    key: "total_inventory_value",
    title: "Total Value",
    icon: DollarSign,
    cssVar: "--accent-violet",
    rgbVar: "--accent-violet-rgb",
    bgClass: "stat-card-violet",
    trend: +2.8,
    subtitle: "inventory valuation",
  },
];

// ── Donut chart colors ────────────────────────────────────────────────────────
const DONUT_COLORS_HEX = [
  "#2563EB", "#EA6C00", "#059669", "#7C3AED", "#D97706", "#0891B2",
];


// ── Greeting helper ───────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatDate() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric",
  }).format(new Date());
}

// ── Animated number counter ───────────────────────────────────────────────────
function AnimatedNumber({ target, prefix = "", suffix = "" }: {
  target: number;
  prefix?: string;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    if (prev.current === target) return;
    const from = prev.current;
    prev.current = target;
    const ctrl = animate(from, target, {
      duration: 1.1,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => ctrl.stop();
  }, [target]);

  return (
    <>
      {prefix}
      {display.toLocaleString()}
      {suffix}
    </>
  );
}

// ── Trend badge ───────────────────────────────────────────────────────────────
function TrendBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
      style={{
        background: positive
          ? "rgba(var(--accent-success-rgb), 0.12)"
          : "rgba(var(--accent-danger-rgb), 0.12)",
        color: positive ? "var(--accent-success)" : "var(--accent-danger)",
      }}
    >
      {positive ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {positive ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  title,
  rawValue,
  subtitle,
  icon: Icon,
  cssVar,
  rgbVar,
  bgClass,
  trend,
  isValue = false,
}: {
  title: string;
  rawValue: number;
  subtitle?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ComponentType<any>;
  cssVar: string;
  rgbVar: string;
  bgClass: string;
  trend: number;
  isValue?: boolean;
}) {
  return (
    <motion.div
      variants={animationVariants.fadeInUp}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={clsx(
        "rounded-2xl p-4 md:p-5 relative overflow-hidden card-hover cursor-default",
        bgClass,
      )}
      style={{ backdropFilter: "blur(24px) saturate(1.8)" }}
    >
      {/* ambient glow orb */}
      <div
        className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl opacity-20 pointer-events-none"
        style={{ background: `var(${cssVar})` }}
      />

      {/* header row: icon + trend */}
      <div className="flex items-start justify-between mb-3 relative">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `rgba(var(${rgbVar}), 0.12)`,
            border: `1px solid rgba(var(${rgbVar}), 0.22)`,
          }}
        >
          <Icon size={18} style={{ color: `var(${cssVar})` }} />
        </div>
        <TrendBadge value={trend} />
      </div>

      {/* big number */}
      <p
        className="leading-none mb-1 tabular-nums relative"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          fontSize: "clamp(22px, 4vw, 34px)",
          color: "var(--text-primary)",
        }}
      >
        {isValue ? (
          <>
            $<AnimatedNumber target={Math.round(rawValue)} />
          </>
        ) : (
          <AnimatedNumber target={rawValue} />
        )}
      </p>

      {/* label + subtitle */}
      <p
        className="text-xs font-semibold uppercase tracking-wider mb-0.5"
        style={{ color: `var(${cssVar})`, fontFamily: "'Outfit', sans-serif" }}
      >
        {title}
      </p>
      {subtitle && (
        <p
          className="text-[11px]"
          style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
        >
          {subtitle}
        </p>
      )}
    </motion.div>
  );
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2.5 text-xs"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(24px) saturate(1.8)",
        boxShadow: "var(--shadow-elevation)",
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <p className="font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <div key={entry.name} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span style={{ color: "var(--text-muted)" }}>{entry.name}</span>
          <span className="font-bold ml-auto pl-4" style={{ color: "var(--text-primary)" }}>
            {entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Activity Flow Chart ───────────────────────────────────────────────────────
type TimeRange = "7d" | "30d" | "90d";

function ActivityFlowChart({ activity }: { activity: InventoryEvent[] }) {
  const [range, setRange] = useState<TimeRange>("7d");

  // Bucket events by day for the selected range
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const chartData = (() => {
    const now = Date.now();
    const msPerDay = 86400000;
    const buckets: { date: string; in: number; out: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * msPerDay);
      buckets.push({
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        in: 0,
        out: 0,
      });
    }

    const cutoff = now - days * msPerDay;
    for (const ev of activity) {
      const t = new Date(ev.occurred_at).getTime();
      if (t < cutoff) continue;
      const dayIdx = Math.floor((t - cutoff) / msPerDay);
      if (dayIdx >= 0 && dayIdx < days) {
        const bucket = buckets[dayIdx];
        if (!bucket) continue;
        if (ev.event_kind === "STOCK_IN") bucket.in += ev.quantity;
        if (ev.event_kind === "STOCK_OUT") bucket.out += ev.quantity;
      }
    }
    return buckets;
  })();

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(24px) saturate(1.8)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* header */}
      <div
        className="px-5 py-4 flex items-center justify-between gap-3 shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div>
          <h3
            className="font-bold text-sm"
            style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
          >
            Activity Flow
          </h3>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
          >
            Stock movements over time
          </p>
        </div>
        {/* time range tabs */}
        <div
          className="flex rounded-lg p-0.5 gap-0.5"
          style={{ background: "var(--border-subtle)" }}
        >
          {(["7d", "30d", "90d"] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all"
              style={
                range === r
                  ? {
                      background: "var(--bg-card)",
                      color: "var(--accent)",
                      boxShadow: "var(--shadow-card)",
                      fontFamily: "'Outfit', sans-serif",
                    }
                  : { color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }
              }
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* chart */}
      <div className="px-4 pt-4 pb-3 flex-1 flex flex-col">
        {/* legend */}
        <div className="flex gap-4 mb-3">
          {[
            { color: "var(--accent)", label: "Stock In" },
            { color: "var(--accent-2)", label: "Stock Out" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 12, right: 20, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-2)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent-2)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{
                fill: "var(--text-muted)",
                fontSize: 10,
                fontFamily: "'Outfit', sans-serif",
              }}
              minTickGap={40}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{
                fill: "var(--text-muted)",
                fontSize: 10,
                fontFamily: "'Outfit', sans-serif",
              }}
              width={36}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="in"
              name="Stock In"
              stroke="var(--accent)"
              strokeWidth={2.5}
              fill="url(#gradIn)"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="out"
              name="Stock Out"
              stroke="var(--accent-2)"
              strokeWidth={2.5}
              fill="url(#gradOut)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Category Donut Chart ──────────────────────────────────────────────────────
function CategoryDonut({
  data,
}: {
  data: Array<{ id: number; name: string; color: string | null; count: number }>;
}) {
  const total = data.reduce((s, c) => s + c.count, 0);

  return (
    <div
      className="rounded-2xl overflow-hidden h-full"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(24px) saturate(1.8)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div
        className="px-5 py-4"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <h3
          className="font-bold text-sm"
          style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
        >
          Category Mix
        </h3>
        <p
          className="text-xs mt-0.5"
          style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
        >
          Inventory by category
        </p>
      </div>

      <div className="px-4 pt-3 pb-1">
        <div className="relative">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={62}
                outerRadius={88}
                paddingAngle={2}
                dataKey="count"
                nameKey="name"
                startAngle={90}
                endAngle={-270}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={entry.id}
                    fill={entry.color ?? DONUT_COLORS_HEX[index % DONUT_COLORS_HEX.length]}
                    stroke="transparent"
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as {
                    name: string;
                    count: number;
                    id: number;
                    color?: string;
                  };
                  const idx = data.findIndex((c) => c.id === d.id);
                  const color = d.color ?? DONUT_COLORS_HEX[idx % DONUT_COLORS_HEX.length];
                  const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                  return (
                    <div
                      className="rounded-xl px-3 py-2.5 text-xs"
                      style={{
                        background: "var(--bg-card)",
                        border: `1px solid ${color}44`,
                        backdropFilter: "blur(24px) saturate(1.8)",
                        boxShadow: "var(--shadow-elevation)",
                        fontFamily: "'Outfit', sans-serif",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                        <span
                          className="font-semibold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {d.name}
                        </span>
                      </div>
                      <p style={{ color: "var(--text-muted)" }}>
                        <span
                          className="font-bold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {d.count}
                        </span>{" "}
                        items ·{" "}
                        <span style={{ color }}>{pct}%</span>
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* center label */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
            style={{ top: 0 }}
          >
            <span
              className="leading-none tabular-nums"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 700,
                fontSize: 26,
                color: "var(--text-primary)",
              }}
            >
              {total.toLocaleString()}
            </span>
            <span
              className="text-[10px] font-medium mt-0.5 uppercase tracking-wider"
              style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
            >
              Items
            </span>
          </div>
        </div>

        {/* custom legend */}
        <div className="space-y-1.5 pb-3 px-1">
          {data.slice(0, 6).map((cat, i) => {
            const color = cat.color ?? DONUT_COLORS_HEX[i % DONUT_COLORS_HEX.length];
            const pct = total > 0 ? ((cat.count / total) * 100).toFixed(0) : "0";
            return (
              <div key={cat.id} className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: color }}
                />
                <span
                  className="text-[11px] flex-1 truncate"
                  style={{ color: "var(--text-secondary)", fontFamily: "'Outfit', sans-serif" }}
                >
                  {cat.name}
                </span>
                <span
                  className="text-[11px] tabular-nums font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Activity row ──────────────────────────────────────────────────────────────
function ActivityRow({ event }: { event: InventoryEvent }) {
  const meta =
    EVENT_ICONS[event.event_kind as keyof typeof EVENT_ICONS] ?? EVENT_ICONS.IMPORT;
  const Icon = meta.icon;
  const isIn = event.event_kind === "STOCK_IN";
  const isOut = event.event_kind === "STOCK_OUT";

  const kindLabel = event.event_kind.replace(/_/g, " ");

  return (
    <motion.div
      variants={animationVariants.listItem}
      className="flex items-center gap-3 py-3 group"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      {/* icon */}
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
        style={{ background: meta.bg }}
      >
        <Icon size={14} style={{ color: meta.color }} />
      </div>

      {/* main info */}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium truncate"
          style={{ color: "var(--text-primary)", fontFamily: "'Outfit', sans-serif" }}
        >
          {event.item_name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
            style={{
              background: meta.bg,
              color: meta.color,
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            {kindLabel}
          </span>
          <span
            className="text-[11px] truncate"
            style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
          >
            {event.to_location_code ?? event.from_location_code ?? "—"}
            {event.actor_username ? ` · ${event.actor_username}` : ""}
          </span>
        </div>
      </div>

      {/* quantity + time */}
      <div className="text-right shrink-0">
        <p
          className="text-sm font-bold tabular-nums"
          style={{
            color: isIn
              ? "var(--accent-success)"
              : isOut
              ? "var(--accent-danger)"
              : "var(--accent-violet)",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {isIn ? "+" : isOut ? "−" : "→"}
          {event.quantity}
        </p>
        <p
          className="text-[10px] mt-0.5"
          style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
        >
          {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
        </p>
      </div>
    </motion.div>
  );
}


// ── Animated watt value ───────────────────────────────────────────────────────
function AnimatedWatt({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    const from = prev.current;
    prev.current = value;
    const ctrl = animate(from, value, {
      duration: 0.9,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => ctrl.stop();
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

// ── Energy Widget ─────────────────────────────────────────────────────────────
function EcoEnergyWidget() {
  const { data: energy, isLoading } = useQuery({
    queryKey: ["dashboard-energy-widget"],
    queryFn: () => energyApi.getDashboard(12),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const navigate = useNavigate();

  if (isLoading || !energy) return <SkeletonCard rows={4} />;
  const { latest, stats, history } = energy;
  if (!latest) return null;

  const isSurplus = stats.savings_status === "SURPLUS";
  const netW = Math.abs(Math.round(latest.net_balance_w ?? 0));
  const solarW = Math.round(latest.solar_current_power_w ?? 0);
  const totalW = Math.round(latest.total_consumption_w ?? 0);
  const acW = Math.round(latest.ac_consumption_w ?? 0);
  const hwhW = Math.round(latest.hwh_consumption_w ?? 0);
  const acOn = (latest.ac_power_mode ?? "").toUpperCase() !== "POWER_OFF";
  const hwhOn = latest.hwh_running === true;

  const n = history.labels.length;
  const start = Math.max(0, n - 24);
  const chartData = history.labels.slice(start).map((label, idx) => ({
    t: label,
    solar: Math.round(history.solar[start + idx] ?? 0),
    total: Math.round(history.consumption[start + idx] ?? 0),
    ac: Math.round((history.ac ?? [])[start + idx] ?? 0),
  }));
  const hasHistory = chartData.length > 1;

  return (
    <motion.div
      variants={animationVariants.fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      onClick={() => navigate("/energy")}
      className="rounded-2xl overflow-hidden relative cursor-pointer group"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(24px) saturate(1.8)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* accent glow */}
      <div
        className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: isSurplus ? "var(--accent-success)" : "var(--accent-danger)" }}
      />

      <div className="relative z-10 p-5">
        {/* header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <motion.div
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{
                background: "rgba(var(--accent-rgb), 0.10)",
                border: "1px solid rgba(var(--accent-rgb), 0.20)",
              }}
            >
              <Zap size={15} style={{ color: "var(--accent)" }} />
            </motion.div>
            <div>
              <p
                className="text-sm font-bold"
                style={{ color: "var(--text-primary)", fontFamily: "'Syne', sans-serif" }}
              >
                EcoEnergy
              </p>
              <div className="flex items-center gap-1.5">
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--accent-success)" }}
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.8 }}
                />
                <span
                  className="text-[9px] font-semibold uppercase tracking-widest"
                  style={{ color: "var(--accent-success)" }}
                >
                  Live · 15s
                </span>
              </div>
            </div>
          </div>

          <span
            className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{
              background: isSurplus
                ? "rgba(var(--accent-success-rgb), 0.10)"
                : "rgba(var(--accent-danger-rgb), 0.10)",
              border: `1px solid ${isSurplus ? "rgba(var(--accent-success-rgb), 0.25)" : "rgba(var(--accent-danger-rgb), 0.25)"}`,
              color: isSurplus ? "var(--accent-success)" : "var(--accent-danger)",
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            {isSurplus ? `+${netW} W` : `−${netW} W`}
          </span>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[
            { icon: Sun,      label: "Solar",    val: solarW, cssVar: "--accent-warning" },
            { icon: Activity, label: "Load",     val: totalW, cssVar: "--accent" },
          ].map(({ icon: Icon, label, val, cssVar }) => (
            <div
              key={label}
              className="rounded-xl p-3"
              style={{
                background: `rgba(var(${cssVar}-rgb, 37,99,235), 0.06)`,
                border: `1px solid rgba(var(${cssVar}-rgb, 37,99,235), 0.14)`,
              }}
            >
              <div
                className="flex items-center gap-1 mb-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: `var(${cssVar})`, fontFamily: "'Outfit', sans-serif" }}
              >
                <Icon size={10} />
                {label}
              </div>
              <p
                className="font-black text-lg tabular-nums leading-none"
                style={{ color: `var(${cssVar})`, fontFamily: "'JetBrains Mono', monospace" }}
              >
                <AnimatedWatt value={val} />
                <span
                  className="text-[10px] font-medium opacity-50 ml-0.5"
                  style={{ fontFamily: "'Outfit', sans-serif" }}
                >
                  W
                </span>
              </p>
            </div>
          ))}
        </div>

        {/* appliance status */}
        <div className="flex gap-2 mb-4">
          {[
            { label: "HVAC", on: acOn,  val: acW,  Icon: Wind,     activeColor: "var(--accent-violet)" },
            { label: "HWH",  on: hwhOn, val: hwhW, Icon: Droplets, activeColor: "var(--accent-2)" },
          ].map(({ label, on, val, Icon, activeColor }) => (
            <div
              key={label}
              className="flex-1 flex items-center gap-1.5 px-2.5 py-2 rounded-xl"
              style={{
                background: on ? `rgba(var(--accent-violet-rgb), 0.06)` : "transparent",
                border: `1px solid ${on ? `rgba(var(--accent-violet-rgb), 0.16)` : "var(--border-subtle)"}`,
              }}
            >
              <motion.span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: on ? activeColor : "var(--text-muted)" }}
                animate={on ? { opacity: [1, 0.3, 1] } : { opacity: 0.4 }}
                transition={{ repeat: Infinity, duration: 1.4 }}
              />
              <Icon size={11} style={{ color: on ? activeColor : "var(--text-muted)" }} />
              <span
                className="text-[10px] font-semibold"
                style={{
                  color: on ? activeColor : "var(--text-muted)",
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                {label}
              </span>
              <span
                className="text-[10px] font-bold ml-auto tabular-nums"
                style={{ color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}
              >
                <AnimatedWatt value={val} />W
              </span>
            </div>
          ))}
        </div>

        {/* mini chart */}
        <div className="h-[80px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 2, left: -30, bottom: 0 }}>
              <defs>
                <linearGradient id="energySolar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-warning)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent-warning)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="energyTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-card)",
                  borderRadius: "10px",
                  fontSize: "11px",
                  fontFamily: "'Outfit', sans-serif",
                }}
                formatter={(v: number) => [`${v} W`, undefined]}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="solar"
                name="Solar"
                stroke="var(--accent-warning)"
                strokeWidth={1.5}
                fill="url(#energySolar)"
                dot={false}
                isAnimationActive={hasHistory}
              />
              <Area
                type="monotone"
                dataKey="total"
                name="Load"
                stroke="var(--accent)"
                strokeWidth={1.5}
                fill="url(#energyTotal)"
                dot={false}
                isAnimationActive={hasHistory}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* hover hint */}
        <p
          className="text-[10px] text-right mt-2 group-hover:opacity-100 opacity-40 transition-opacity"
          style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
        >
          Open Energy Hub →
        </p>
      </div>
    </motion.div>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────
export function Dashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30_000,
  });
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const firstName = user?.full_name.split(" ")[0] ?? "there";

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className="px-4 py-6 md:px-6 md:py-8 pb-24 lg:pb-8 space-y-5 max-w-screen-2xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonKpiCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <SkeletonCard rows={5} />
          </div>
          <SkeletonCard rows={5} />
        </div>
        <SkeletonCard rows={6} />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle size={32} style={{ color: "var(--accent-danger)" }} />
        <p
          className="text-sm"
          style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
        >
          Failed to load dashboard data.
        </p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 pb-24 lg:pb-8 space-y-5 max-w-screen-2xl mx-auto">

      {/* ── Header ── */}
      <motion.div
        variants={animationVariants.fadeInUp}
        initial="hidden"
        animate="visible"
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <div
            className="text-xs font-medium uppercase tracking-widest mb-1"
            style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
          >
            {formatDate()} · {getGreeting()}, {firstName}
          </div>
          <h1
            className="leading-tight"
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: "clamp(22px, 4vw, 30px)",
              color: "var(--text-primary)",
            }}
          >
            Dashboard
          </h1>
          <p
            className="text-sm mt-0.5"
            style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
          >
            {stats.active_alerts > 0
              ? `${stats.active_alerts} alert${stats.active_alerts > 1 ? "s" : ""} need attention · ${stats.transactions_today} transactions today`
              : `All systems nominal · ${stats.transactions_today} transactions today`}
          </p>
        </div>

      </motion.div>

      {/* ── KPI Cards ── */}
      <motion.div
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3"
        variants={animationVariants.staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {KPI_CONFIGS.map(({ key, title, icon, cssVar, rgbVar, bgClass, trend, subtitle, subKey, subLabel }) => {
          const rawVal = (stats as unknown as Record<string, number>)[key] ?? 0;
          const subValue = subKey
            ? (stats as unknown as Record<string, number>)[subKey]
            : undefined;
          const computedSubtitle =
            subKey && subValue !== undefined
              ? `${subValue} ${subLabel}`
              : subtitle;

          return (
            <KpiCard
              key={key}
              title={title}
              rawValue={rawVal}
              subtitle={computedSubtitle}
              icon={icon}
              cssVar={cssVar}
              rgbVar={rgbVar}
              bgClass={bgClass}
              trend={trend}
              isValue={key === "total_inventory_value"}
            />
          );
        })}
      </motion.div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        {/* Activity flow — 2 cols */}
        <div className="lg:col-span-2 flex flex-col">
          <motion.div
            className="flex-1 flex flex-col"
            variants={animationVariants.fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
          >
            <ActivityFlowChart activity={stats.recent_activity} />
          </motion.div>
        </div>

        {/* Category donut — 1 col */}
        <motion.div
          className="flex flex-col"
          variants={animationVariants.fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
        >
          <CategoryDonut data={stats.category_breakdown} />
        </motion.div>
      </div>

      {/* ── Recent transactions + Energy widget ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent activity — 2 cols */}
        <motion.div
          className="lg:col-span-2"
          variants={animationVariants.fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
        >
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              backdropFilter: "blur(24px) saturate(1.8)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {/* header */}
            <div
              className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div>
                <h3
                  className="font-bold text-sm"
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    color: "var(--text-primary)",
                  }}
                >
                  Recent Transactions
                </h3>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "var(--text-muted)", fontFamily: "'Outfit', sans-serif" }}
                >
                  {stats.transactions_this_week} this week
                </p>
              </div>
              <button
                onClick={() => navigate("/transactions")}
                className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-75"
                style={{ color: "var(--accent)", fontFamily: "'Outfit', sans-serif" }}
              >
                View All
                <ChevronRight size={13} />
              </button>
            </div>

            {/* activity list */}
            <div className="px-5">
              {stats.recent_activity.length === 0 ? (
                <div className="py-12 text-center">
                  <Layers
                    size={32}
                    className="mx-auto mb-3"
                    style={{ color: "var(--text-muted)" }}
                  />
                  <p
                    className="text-sm"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "'Outfit', sans-serif",
                    }}
                  >
                    No transactions yet
                  </p>
                </div>
              ) : (
                <motion.div
                  variants={animationVariants.staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {stats.recent_activity.slice(0, 8).map((event) => (
                    <ActivityRow key={event.id} event={event} />
                  ))}
                </motion.div>
              )}
            </div>

            {/* mobile "show more" button */}
            {stats.recent_activity.length > 5 && (
              <div className="px-5 pb-4 pt-2 lg:hidden">
                <button
                  onClick={() => navigate("/transactions")}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
                  style={{
                    background: "rgba(var(--accent-rgb), 0.08)",
                    border: "1px solid rgba(var(--accent-rgb), 0.18)",
                    color: "var(--accent)",
                    fontFamily: "'Outfit', sans-serif",
                  }}
                >
                  Show all activity
                </button>
              </div>
            )}
          </div>
        </motion.div>

        {/* Energy widget — 1 col */}
        <EcoEnergyWidget />
      </div>
    </div>
  );
}
