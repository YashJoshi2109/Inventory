import { useQuery } from "@tanstack/react-query";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { motion, animate } from "framer-motion";
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
import { Sun, TrendingUp, Droplets, Wind } from "lucide-react";

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

// ── Animated number counter ───────────────────────────────────────────────────
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

// ── Half-circle SVG gauge (bigger + cleaner) ──────────────────────────────────
const GR = 80; const GCX = 100; const GCY = 94;
const GARC = Math.PI * GR; // 251.3

function SolarGauge({ solarW, totalW }: { solarW: number; totalW: number }) {
  const pct = totalW > 0 ? Math.min(100, Math.max(0, (solarW / totalW) * 100)) : 0;
  const fillLen = (pct / 100) * GARC;
  const d = `M ${GCX - GR},${GCY} A ${GR},${GR} 0 0 1 ${GCX + GR},${GCY}`;
  const needleRad = ((-90 + (pct / 100) * 180) * Math.PI) / 180;
  const nx = GCX + (GR - 16) * Math.cos(needleRad);
  const ny = GCY + (GR - 16) * Math.sin(needleRad);

  return (
    <div className="flex flex-col items-center justify-center shrink-0">
      <svg viewBox="0 0 200 106" className="w-52 h-auto overflow-visible">
        <defs>
          <linearGradient id="gG" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="55%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <filter id="gF" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#34d399" floodOpacity="0.6" />
          </filter>
          <filter id="gF0" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f59e0b" floodOpacity="0.4" />
          </filter>
        </defs>

        {/* Outer ring track */}
        <path d={d} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={14} strokeLinecap="round" />

        {/* Segment ticks */}
        {[0,25,50,75,100].map((t) => {
          const a = ((-90 + (t / 100) * 180) * Math.PI) / 180;
          return (
            <line key={t}
              x1={GCX + (GR + 6) * Math.cos(a)} y1={GCY + (GR + 6) * Math.sin(a)}
              x2={GCX + (GR + 13) * Math.cos(a)} y2={GCY + (GR + 13) * Math.sin(a)}
              stroke={t === 0 || t === 100 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.18)"}
              strokeWidth={t % 50 === 0 ? 2 : 1.2} strokeLinecap="round"
            />
          );
        })}

        {/* Filled arc — animated */}
        <motion.path
          d={d} fill="none" stroke="url(#gG)" strokeWidth={14} strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${GARC + 20}` }}
          animate={{ strokeDasharray: `${fillLen} ${GARC + 20}` }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
          filter={pct > 3 ? `url(#${pct > 50 ? "gF" : "gF0"})` : undefined}
        />

        {/* Needle */}
        <motion.line
          x1={GCX} y1={GCY} x2={nx} y2={ny}
          stroke="rgba(255,255,255,0.9)" strokeWidth={2.5} strokeLinecap="round"
          animate={{ x2: nx, y2: ny }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
        />
        <circle cx={GCX} cy={GCY} r={5} fill="white" opacity={0.95} />
        <circle cx={GCX} cy={GCY} r={2.5} fill="#030712" opacity={0.8} />

        {/* Center big pct */}
        <text x={GCX} y={GCY - 16} textAnchor="middle" fill="white"
          fontSize="24" fontWeight="900" fontFamily="system-ui,sans-serif">{Math.round(pct)}%</text>
        <text x={GCX} y={GCY - 1} textAnchor="middle" fill="#64748b"
          fontSize="7" fontWeight="600" fontFamily="system-ui,sans-serif" letterSpacing="0.12em">SOLAR COVERAGE</text>

        {/* Boundary labels */}
        <text x={GCX - GR - 6} y={GCY + 16} textAnchor="end"
          fill="#475569" fontSize="8" fontFamily="system-ui,sans-serif">0%</text>
        <text x={GCX + GR + 6} y={GCY + 16} textAnchor="start"
          fill="#475569" fontSize="8" fontFamily="system-ui,sans-serif">100%</text>

        {/* Solar W label below */}
        <text x={GCX} y={GCY + 18} textAnchor="middle" fill="#f59e0b"
          fontSize="9.5" fontWeight="700" fontFamily="system-ui,sans-serif">
          {solarW > 0 ? `☀ ${Math.round(solarW)} W generating` : "☾ No solar input"}
        </text>
      </svg>
    </div>
  );
}

// ── Power breakdown bar ────────────────────────────────────────────────────────
function PowerBar({
  label, watts, totalW, color, icon: Icon, delay = 0,
}: {
  label: string;
  watts: number;
  totalW: number;
  color: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ComponentType<any>;
  delay?: number;
}) {
  const pct = totalW > 0 ? Math.min(100, (watts / totalW) * 100) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="flex items-center gap-2.5"
    >
      <div className="flex items-center gap-1.5 w-20 shrink-0">
        <Icon size={10} style={{ color }} />
        <span className="text-[10px] font-semibold text-slate-400 truncate">{label}</span>
      </div>
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}cc, ${color})` }}
          initial={{ width: "0%" }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.2, delay: delay + 0.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="text-[10px] font-bold w-14 text-right shrink-0 tabular-nums" style={{ color }}>
        <AnimatedWatt value={Math.round(watts)} />W
      </span>
      <span className="text-[9px] text-slate-600 w-8 text-right shrink-0 tabular-nums">
        {Math.round(pct)}%
      </span>
    </motion.div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────
function EcoEnergyWidget() {
  const { data: energy, isLoading } = useQuery({
    queryKey: ["dashboard-energy-widget"],
    queryFn: () => energyApi.getDashboard(12),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const navigate = useNavigate();

  if (isLoading || !energy) {
    return <SkeletonCard rows={5} />;
  }

  const { latest, stats, history } = energy;
  if (!latest) return null;

  const isSurplus = stats.savings_status === "SURPLUS";
  const netW = Math.abs(Math.round(latest.net_balance_w ?? 0));
  const solarW = Math.round(latest.solar_current_power_w ?? 0);
  const totalW = Math.round(latest.total_consumption_w ?? 0);
  const acW = Math.round(latest.ac_consumption_w ?? 0);
  const hwhW = Math.round(latest.hwh_consumption_w ?? 0);
  const baseW = Math.max(0, totalW - acW - hwhW);
  const acOn = (latest.ac_power_mode ?? "").toUpperCase() !== "POWER_OFF";
  const hwhOn = latest.hwh_running === true;

  // ── FIXED: correct chart data indexing ──────────────────────────────────────
  const n = history.labels.length;
  const start = Math.max(0, n - 24);
  const rawChart = history.labels.slice(start).map((label, idx) => ({
    t: label,
    solar: Math.round(history.solar[start + idx] ?? 0),
    ac:    Math.round((history.ac  ?? [])[start + idx] ?? 0),
    hwh:   Math.round((history.hwh ?? [])[start + idx] ?? 0),
    total: Math.round(history.consumption[start + idx] ?? 0),
  }));

  // If no history yet, seed with a single live reading so chart isn't empty
  const chartData = rawChart.length === 0
    ? [{ t: "Now", solar: solarW, ac: acW, hwh: hwhW, total: totalW }]
    : rawChart;

  const hasRealHistory = rawChart.length > 1;

  return (
    <motion.div
      variants={animationVariants.fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      className="col-span-1 lg:col-span-3 rounded-3xl overflow-hidden relative cursor-pointer group"
      onClick={() => navigate("/energy")}
      style={{
        background: "linear-gradient(150deg, rgba(4,8,20,0.95) 0%, rgba(7,14,32,0.98) 100%)",
        border: "1px solid rgba(34,211,238,0.13)",
        backdropFilter: "blur(24px)",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 32px 64px rgba(0,0,0,0.5)",
      }}
    >
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
        <motion.div
          animate={{ opacity: isSurplus ? 0.08 : 0.06 }}
          transition={{ duration: 1 }}
          className="absolute -top-16 -right-16 w-80 h-80 rounded-full blur-3xl"
          style={{ background: isSurplus ? "#10b981" : "#f87171" }}
        />
        <div className="absolute -bottom-12 -left-8 w-48 h-48 rounded-full blur-3xl opacity-5"
          style={{ background: "#22d3ee" }} />
      </div>

      <div className="relative z-10 p-5 flex flex-col gap-4">

        {/* ── Row 1: Header ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 2.6, ease: "easeInOut" }}
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.28)" }}
            >
              <Zap size={16} className="text-cyan-400" />
            </motion.div>
            <div>
              <p className="text-sm font-bold text-white tracking-wide">EcoEnergy Hub</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <motion.span className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                  animate={{ opacity: [1, 0.2, 1] }} transition={{ repeat: Infinity, duration: 1.8 }} />
                <span className="text-[10px] text-cyan-400/60 font-semibold uppercase tracking-widest">Live · 15 s</span>
              </div>
            </div>
          </div>

          <motion.div
            animate={{ scale: [1, 1.025, 1] }}
            transition={{ repeat: Infinity, duration: 3.2 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0"
            style={{
              background: isSurplus ? "rgba(16,185,129,0.12)" : "rgba(248,113,113,0.1)",
              border: `1px solid ${isSurplus ? "rgba(16,185,129,0.32)" : "rgba(248,113,113,0.3)"}`,
              color: isSurplus ? "#10b981" : "#f87171",
            }}
          >
            {isSurplus ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {isSurplus ? `+${netW} W SURPLUS` : `−${netW} W DEFICIT`}
          </motion.div>
        </div>

        {/* ── Row 2: Gauge LEFT + Stats RIGHT ── */}
        <div className="flex items-start gap-4">

          {/* Gauge */}
          <SolarGauge solarW={solarW} totalW={totalW} />

          {/* Right: two KPI pairs + status dots */}
          <div className="flex-1 flex flex-col justify-center gap-3 min-w-0">
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Sun,      label: "Solar Gen",  val: solarW, unit: "W", color: "#f59e0b" },
                { icon: Activity, label: "Total Load", val: totalW, unit: "W", color: "#22d3ee" },
              ].map(({ icon: Icon, label, val, color, unit }) => (
                <motion.div key={label}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="rounded-2xl p-3 relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${color}0a 0%, rgba(255,255,255,0.02) 100%)`,
                    border: `1px solid ${color}1a`,
                  }}
                >
                  <div className="absolute top-0 right-0 w-10 h-10 rounded-full blur-xl opacity-20" style={{ background: color }} />
                  <div className="flex items-center gap-1 mb-1" style={{ color: `${color}90` }}>
                    <Icon size={10} />
                    <span className="text-[9px] font-bold uppercase tracking-widest">{label}</span>
                  </div>
                  <p className="text-lg font-black leading-none" style={{ color }}>
                    <AnimatedWatt value={val} />
                    <span className="text-[10px] font-semibold opacity-50 ml-0.5">{unit}</span>
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Appliance status strip */}
            <div className="flex gap-2">
              {[
                { label: "HVAC", on: acOn,  color: acOn  ? "#818cf8" : "#475569", Icon: Wind },
                { label: "HWH",  on: hwhOn, color: hwhOn ? "#fb923c" : "#475569", Icon: Droplets },
              ].map(({ label, on, color, Icon }) => (
                <div key={label}
                  className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{
                    background: on ? `${color}12` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${on ? `${color}28` : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <motion.span className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: color }}
                    animate={on ? { opacity: [1, 0.3, 1] } : { opacity: 0.4 }}
                    transition={{ repeat: Infinity, duration: 1.4 }}
                  />
                  <Icon size={11} style={{ color }} />
                  <span className="text-[10px] font-semibold" style={{ color }}>{label}</span>
                  <span className="text-[9px] ml-auto font-bold tabular-nums" style={{ color: `${color}cc` }}>
                    <AnimatedWatt value={label === "HVAC" ? acW : hwhW} />W
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 3: Power breakdown bars (always visible — AC/HWH/Base have real values) ── */}
        <div className="rounded-2xl p-3.5 flex flex-col gap-2.5"
          style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-0.5">Power Breakdown</p>
          <PowerBar label="Solar"   watts={solarW} totalW={totalW} color="#f59e0b" icon={Sun}      delay={0}    />
          <PowerBar label="HVAC"    watts={acW}    totalW={totalW} color="#818cf8" icon={Wind}     delay={0.06} />
          <PowerBar label="Heater"  watts={hwhW}   totalW={totalW} color="#fb923c" icon={Droplets} delay={0.12} />
          <PowerBar label="Base"    watts={baseW}  totalW={totalW} color="#22d3ee" icon={Activity} delay={0.18} />
        </div>

        {/* ── Row 4: Area chart — AC + HWH always have non-zero data ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">
              {hasRealHistory ? "Last 2 Hours" : "Live (no history yet)"}
            </p>
            <div className="flex items-center gap-3">
              {[
                { color: "#f59e0b", label: "Solar" },
                { color: "#818cf8", label: "HVAC" },
                { color: "#22d3ee", label: "Load" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-[9px] text-slate-600">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="h-[100px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="t" axisLine={false} tickLine={false}
                  tick={{ fill: "#334155", fontSize: 8 }} tickMargin={5} minTickGap={50}
                  interval="preserveStartEnd"
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#334155", fontSize: 8 }} width={28} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(4,8,20,0.97)", border: "1px solid rgba(34,211,238,0.2)",
                    borderRadius: "10px", fontSize: "11px", backdropFilter: "blur(20px)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  }}
                  itemStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
                  cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1, strokeDasharray: "3 3" }}
                  formatter={(v: number) => [`${v} W`, undefined]}
                  isAnimationActive={false}
                />
                <Area type="monotone" dataKey="solar" stroke="#f59e0b" strokeWidth={1.8}
                  fill="url(#gS)" name="Solar" dot={false} isAnimationActive={hasRealHistory} />
                <Area type="monotone" dataKey="ac" stroke="#818cf8" strokeWidth={1.8}
                  fill="url(#gA)" name="HVAC" dot={false} isAnimationActive={hasRealHistory} />
                <Area type="monotone" dataKey="total" stroke="#22d3ee" strokeWidth={1.8}
                  fill="url(#gT)" name="Load" dot={false} isAnimationActive={hasRealHistory} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Row 5: Footer stats ── */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-white/[0.05]">
          {[
            { label: "Solar Peak",  val: `${Math.round(stats.solar_peak_today)} W`, color: "#f59e0b" },
            { label: "Avg Load",    val: `${Math.round(stats.total_consumption_avg)} W`, color: "#22d3ee" },
            { label: "Net Balance", val: `${isSurplus ? "+" : "−"}${netW} W`, color: isSurplus ? "#10b981" : "#f87171" },
            { label: "Status",      val: stats.savings_status, color: isSurplus ? "#10b981" : "#f87171" },
          ].map(({ label, val, color }) => (
            <div key={label} className="text-center">
              <p className="text-[8px] text-slate-700 uppercase tracking-widest font-semibold">{label}</p>
              <p className="text-[10px] font-bold mt-0.5 tabular-nums" style={{ color }}>{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Hover hint */}
      <div className="absolute bottom-3 right-4 text-[9px] text-slate-700 group-hover:text-slate-400 transition-colors font-medium tracking-wide">
        Open Energy Hub →
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
