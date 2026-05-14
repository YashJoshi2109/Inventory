import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Zap,
  Sun,
  Home,
  Wind,
  Thermometer,
  Droplets,
  TrendingUp,
  TrendingDown,
  Brain,
  Plug,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  Activity,
  Flame,
  Building2,
  DoorOpen,
  DoorClosed,
  BarChart3,
} from "lucide-react";
import { energyApi, type EnergyLatest, type InfluxLiveData } from "@/api/energy";

// ── Lab Schedule ──────────────────────────────────────────────────────────────

const LAB_SCHEDULE: Record<number, { open: number; close: number } | null> = {
  0: null,
  1: { open: 9,  close: 18 },
  2: { open: 9,  close: 18 },
  3: { open: 9,  close: 18 },
  4: { open: 9,  close: 18 },
  5: { open: 9,  close: 17 },
  6: null,
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface LabStatus { isOpen: boolean; label: string; detail: string; next: string; }

function getLabStatus(): LabStatus {
  const now = new Date();
  const day = now.getDay();
  const h = now.getHours() + now.getMinutes() / 60;
  const sched = LAB_SCHEDULE[day];

  if (!sched || h >= sched.close) {
    let nd = (day + 1) % 7, tries = 0;
    while (!LAB_SCHEDULE[nd] && tries++ < 6) nd = (nd + 1) % 7;
    const ns = LAB_SCHEDULE[nd];
    return {
      isOpen: false,
      label: "CLOSED",
      detail: !sched ? "Closed today" : "Closed for today",
      next: ns ? `Opens ${DAY_NAMES[nd]} ${ns.open}:00` : "—",
    };
  }

  if (h < sched.open) {
    const mins = Math.round((sched.open - h) * 60);
    return {
      isOpen: false,
      label: "CLOSED",
      detail: `Opens at ${sched.open}:00`,
      next: `In ${Math.floor(mins / 60)}h ${mins % 60}m`,
    };
  }

  const rem = sched.close - h;
  return {
    isOpen: true,
    label: "OPEN",
    detail: `Until ${sched.close}:00`,
    next: `${Math.floor(rem)}h ${Math.round((rem % 1) * 60)}m left`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function solarPercent(solar: number, total: number): number {
  if (total <= 0) return solar > 0 ? 100 : 0;
  return Math.min(100, (solar / total) * 100);
}

const AC_ON = (mode: string | null) =>
  mode != null && mode !== "POWER_OFF" && mode !== "nan" && mode !== "";

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  accent,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  sub?: React.ReactNode;
  accent: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="relative flex flex-col gap-3 rounded-2xl p-4 overflow-hidden"
      style={{
        background: highlight
          ? `linear-gradient(145deg, ${accent}1a, ${accent}0d)`
          : "var(--bg-card)",
        border: `1px solid ${accent}${highlight ? "44" : "1c"}`,
        boxShadow: highlight ? `0 0 32px ${accent}1a` : undefined,
      }}
    >
      <div
        className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full pointer-events-none"
        style={{ background: `${accent}0d`, filter: "blur(20px)" }}
      />
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accent}1a`, border: `1px solid ${accent}33` }}
      >
        <Icon size={16} style={{ color: accent }} />
      </div>
      <div>
        <div className="flex items-end gap-1 mb-1">
          <span
            className="text-2xl font-black tabular-nums leading-none"
            style={{ color: "var(--text-primary)" }}
          >
            {value}
          </span>
          {unit && (
            <span className="text-sm font-bold mb-0.5" style={{ color: accent }}>
              {unit}
            </span>
          )}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {label}
        </p>
        {sub && (
          <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

function SurplusBadge({ status }: { status: "SURPLUS" | "DEFICIT" | "UNKNOWN" }) {
  if (status === "SURPLUS") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full"
        style={{
          background: "rgba(52,211,153,0.15)",
          color: "#34d399",
          border: "1px solid rgba(52,211,153,0.3)",
        }}
      >
        <TrendingUp size={11} /> SURPLUS
      </span>
    );
  }
  if (status === "DEFICIT") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full"
        style={{
          background: "rgba(239,68,68,0.12)",
          color: "#f87171",
          border: "1px solid rgba(239,68,68,0.3)",
        }}
      >
        <TrendingDown size={11} /> DEFICIT
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full"
      style={{
        background: "rgba(100,116,139,0.12)",
        color: "#94a3b8",
        border: "1px solid rgba(100,116,139,0.25)",
      }}
    >
      UNKNOWN
    </span>
  );
}

function StatusDot({ on, label, color }: { on: boolean; label: string; color: string }) {
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
      style={
        on
          ? { background: `${color}1a`, color, border: `1px solid ${color}44` }
          : {
              background: "rgba(71,85,105,0.15)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-card)",
            }
      }
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: on ? color : "#475569" }}
      />
      {on ? label : "OFF"}
    </span>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-2xl p-3 text-xs space-y-1.5 min-w-[170px]"
      style={{
        background: "var(--bg-card-solid)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(24px) saturate(1.8)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
      }}
    >
      <p className="font-bold mb-2" style={{ color: "var(--text-primary)" }}>
        {label}
      </p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {Math.round(p.value)} W
          </span>
        </div>
      ))}
    </div>
  );
}

function ApplianceRow({
  icon: Icon,
  label,
  watts,
  status,
  iconColor,
}: {
  icon: React.ElementType;
  label: string;
  watts: number;
  status: React.ReactNode;
  iconColor?: string;
}) {
  return (
    <div
      className="flex items-center justify-between py-3 px-3 rounded-xl"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: iconColor ? `${iconColor}1a` : "rgba(71,85,105,0.15)",
            border: `1px solid ${iconColor ? `${iconColor}33` : "var(--border-card)"}`,
          }}
        >
          <Icon size={14} style={{ color: iconColor ?? "var(--text-muted)" }} />
        </div>
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            {label}
          </p>
          <p className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {Math.round(watts)} W
          </p>
        </div>
      </div>
      {status}
    </div>
  );
}

// ── Gradient defs for AreaChart ───────────────────────────────────────────────

function ChartDefs() {
  return (
    <defs>
      <linearGradient id="gradSolar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#ffe600" stopOpacity={0.35} />
        <stop offset="95%" stopColor="#ffe600" stopOpacity={0.02} />
      </linearGradient>
      <linearGradient id="gradNet" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
        <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
      </linearGradient>
      <linearGradient id="gradHvac" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#0088ff" stopOpacity={0.28} />
        <stop offset="95%" stopColor="#0088ff" stopOpacity={0.02} />
      </linearGradient>
      <linearGradient id="gradHwh" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#ff6600" stopOpacity={0.28} />
        <stop offset="95%" stopColor="#ff6600" stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EnergyDashboard() {
  const [labStatus, setLabStatus] = useState<LabStatus>(getLabStatus);

  useEffect(() => {
    const id = setInterval(() => setLabStatus(getLabStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["energy-dashboard"],
    queryFn: () => energyApi.getDashboard(24),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: influxData } = useQuery<InfluxLiveData>({
    queryKey: ["energy-grafana-live"],
    queryFn: () => energyApi.getGrafanaLive(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const latest = data?.latest as EnergyLatest | null | undefined;
  const history = data?.history;
  const stats   = data?.stats;
  const influx  = influxData?.latest;

  const influxLive = influxData?.live === true;
  const anyLive    = influxLive || !!data?.live;

  // Merge: InfluxDB overrides Postgres where non-null
  const mergedLatest = latest
    ? {
        ...latest,
        solar_current_power_w: influx?.solar_current_power_w ?? latest.solar_current_power_w,
        net_balance_w:         influx?.net_balance_w         ?? latest.net_balance_w,
        ac_consumption_w:      influx?.ac_consumption_w      ?? latest.ac_consumption_w,
        hwh_consumption_w:     influx?.hwh_consumption_w     ?? latest.hwh_consumption_w,
      }
    : null;

  // InfluxDB-derived stats (used when Postgres has no data)
  const influxSolarPeak = influxData?.history?.solar?.length
    ? Math.round(Math.max(...influxData.history.solar)) : null;
  const influxHvacAvg = influxData?.history?.hvac?.length
    ? influxData.history.hvac.reduce((a, b) => a + b, 0) / influxData.history.hvac.length : null;
  const influxHwhAvg = influxData?.history?.hwh?.length
    ? influxData.history.hwh.reduce((a, b) => a + b, 0) / influxData.history.hwh.length : null;
  const influxAvgLoad = influxHvacAvg != null
    ? Math.round(influxHvacAvg + (influxHwhAvg ?? 0) + 500) : null;

  const displaySolarPeak = influxSolarPeak ?? stats?.solar_peak_today ?? 0;
  const displayAvgLoad   = influxAvgLoad   ?? stats?.total_consumption_avg ?? 0;

  // Derive energy status from actual net balance
  const netW = Math.round(mergedLatest?.net_balance_w ?? 0);
  const energyStatus: "SURPLUS" | "DEFICIT" | "UNKNOWN" =
    mergedLatest ? (netW >= 0 ? "SURPLUS" : "DEFICIT") : "UNKNOWN";

  // AC & HWH on/off
  const acWatts  = mergedLatest?.ac_consumption_w  ?? 0;
  const hwhWatts = mergedLatest?.hwh_consumption_w ?? 0;
  const acOn  = influx?.ac_consumption_w  != null ? acWatts  > 50 : AC_ON(latest?.ac_power_mode ?? null);
  const hwhOn = influx?.hwh_consumption_w != null ? hwhWatts > 50 : !!(latest?.hwh_running);

  const indoorTempC  = influx?.ac_current_temp_c ?? null;
  const targetTempC  = influx?.ac_target_temp_c  ?? null;
  const pctSolar     = mergedLatest
    ? solarPercent(mergedLatest.solar_current_power_w, mergedLatest.total_consumption_w)
    : 0;

  // Chart data — prefer InfluxDB (30 s) over Postgres (5 min)
  const chartData = useMemo(() => {
    if (influxData?.history?.labels?.length) {
      return influxData.history.labels.map((label, i) => ({
        label,
        Solar:          influxData.history.solar[i]                       ?? 0,
        "Net Balance":  influxData.history.net[i]                         ?? 0,
        HVAC:           (influxData.history.hvac  ?? [])[i]               ?? 0,
        "Water Htr":    (influxData.history.hwh   ?? [])[i]               ?? 0,
      }));
    }
    if (!history?.labels) return [];
    return history.labels.map((label, i) => ({
      label,
      Solar:       history.solar[i]       ?? 0,
      HVAC:        history.ac[i]          ?? 0,
      "Water Htr": history.hwh[i]         ?? 0,
      Total:       history.consumption[i] ?? 0,
    }));
  }, [history, influxData]);

  const syncTime = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  const heroGradient =
    energyStatus === "SURPLUS"
      ? "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(52,211,153,0.06) 60%, var(--bg-card) 100%)"
      : energyStatus === "DEFICIT"
      ? "linear-gradient(135deg, rgba(239,68,68,0.18) 0%, rgba(248,113,113,0.06) 60%, var(--bg-card) 100%)"
      : "var(--bg-card)";

  const heroAccent =
    energyStatus === "SURPLUS" ? "#34d399" : energyStatus === "DEFICIT" ? "#f87171" : "#94a3b8";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-full pb-8"
      style={{ background: "var(--bg-page)", color: "var(--text-primary)" }}
    >

      {/* ── Sticky Header ────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 px-5 py-3.5"
        style={{
          background: "var(--bg-card)",
          backdropFilter: "blur(28px) saturate(1.8)",
          borderBottom: "1px solid var(--border-subtle)",
          boxShadow: "0 1px 24px rgba(0,0,0,0.18)",
        }}
      >
        {/* Left: Title */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg,#d97706,#fbbf24)",
              boxShadow: "0 0 20px rgba(251,191,36,0.3)",
            }}
          >
            <Zap size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-black tracking-tight leading-tight" style={{ color: "var(--text-primary)" }}>
              Eco<span style={{ color: "#fbbf24" }}>Energy</span> Hub
            </h1>
            <p className="text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>
              SEAR Lab · Real-time monitoring
            </p>
          </div>
        </div>

        {/* Center: Lab status pill */}
        <div
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold"
          style={
            labStatus.isOpen
              ? {
                  background: "rgba(16,185,129,0.12)",
                  color: "#10b981",
                  border: "1px solid rgba(16,185,129,0.3)",
                }
              : {
                  background: "rgba(239,68,68,0.1)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.28)",
                }
          }
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: labStatus.isOpen ? "#10b981" : "#ef4444",
              boxShadow: labStatus.isOpen ? "0 0 6px #10b981" : "0 0 6px #ef4444",
            }}
          />
          <span>{labStatus.label}</span>
          <span className="opacity-70">·</span>
          <span className="font-medium opacity-90">{labStatus.detail}</span>
          <span className="opacity-70">·</span>
          <span className="font-medium opacity-80">{labStatus.next}</span>
        </div>

        {/* Right: Live badge + refresh */}
        <div className="flex items-center gap-2">
          <div
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium"
            style={{
              background: anyLive ? "rgba(52,211,153,0.08)" : "rgba(239,68,68,0.08)",
              border: `1px solid ${anyLive ? "rgba(52,211,153,0.25)" : "rgba(239,68,68,0.25)"}`,
              color: anyLive ? "#34d399" : "#f87171",
            }}
          >
            {anyLive ? <Wifi size={11} /> : <WifiOff size={11} />}
            <span>
              {influxLive ? `InfluxDB · ${syncTime}` : data?.live ? `Live · ${syncTime}` : "No data"}
            </span>
          </div>
          <button
            onClick={() => void refetch()}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              color: "var(--text-secondary)",
            }}
            title="Refresh"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-4">

        {/* ── Error / No-data banners ─────────────────────────────────────── */}
        {isError && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <AlertTriangle size={16} style={{ color: "#f87171" }} className="shrink-0" />
            <p className="text-sm" style={{ color: "#fca5a5" }}>
              Could not load energy data. Make sure the backend is reachable and the{" "}
              <code style={{ color: "#fecaca", fontSize: 11 }}>energy_readings</code> table exists in Supabase.
            </p>
          </div>
        )}

        {!isLoading && data?.live === false && !isError && !influxLive && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)" }}
          >
            <AlertTriangle size={16} style={{ color: "#fbbf24" }} className="shrink-0" />
            <p className="text-sm" style={{ color: "#fcd34d" }}>
              No readings yet. Start the HVAC Python collector (
              <code style={{ color: "#fef08a", fontSize: 11 }}>python3 run_live.py</code>
              ) to begin streaming data.
            </p>
          </div>
        )}

        {/* ── Hero Row: Net Balance + Lab Status ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">

          {/* Net Balance Hero */}
          <div
            className="relative rounded-2xl p-6 overflow-hidden"
            style={{
              background: heroGradient,
              border: `1px solid ${heroAccent}33`,
              boxShadow: `0 0 48px ${heroAccent}18`,
            }}
          >
            {/* Background glow blob */}
            <div
              className="absolute -top-12 -right-12 w-56 h-56 rounded-full pointer-events-none"
              style={{ background: `${heroAccent}0d`, filter: "blur(40px)" }}
            />

            <div className="relative flex flex-col gap-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                    Net Energy Balance
                  </p>
                  <div className="flex items-end gap-2">
                    <span
                      className="text-5xl font-black tabular-nums leading-none"
                      style={{ color: heroAccent }}
                    >
                      {netW >= 0 ? "+" : "−"}{Math.abs(netW).toLocaleString()}
                    </span>
                    <span className="text-xl font-bold mb-1" style={{ color: heroAccent }}>
                      W
                    </span>
                    {/* Animated pulse */}
                    <span
                      className="mb-2 w-2.5 h-2.5 rounded-full animate-pulse"
                      style={{ background: heroAccent }}
                    />
                  </div>
                </div>
                <SurplusBadge status={energyStatus} />
              </div>

              <div className="flex flex-wrap gap-4 pt-1" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(255,230,0,0.12)", border: "1px solid rgba(255,230,0,0.2)" }}
                  >
                    <Sun size={13} style={{ color: "#ffe600" }} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Solar</p>
                    <p className="text-sm font-black tabular-nums" style={{ color: "#ffe600" }}>
                      {Math.round(mergedLatest?.solar_current_power_w ?? 0).toLocaleString()} W
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(0,136,255,0.12)", border: "1px solid rgba(0,136,255,0.2)" }}
                  >
                    <Home size={13} style={{ color: "#0088ff" }} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Load</p>
                    <p className="text-sm font-black tabular-nums" style={{ color: "#0088ff" }}>
                      {Math.round(latest?.total_consumption_w ?? 0).toLocaleString()} W
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)" }}
                  >
                    <BarChart3 size={13} style={{ color: "#8b5cf6" }} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Solar %</p>
                    <p className="text-sm font-black tabular-nums" style={{ color: "#8b5cf6" }}>
                      {fmt(pctSolar, 1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Lab Status Card */}
          <div
            className="relative rounded-2xl p-5 overflow-hidden flex flex-col gap-4"
            style={
              labStatus.isOpen
                ? {
                    background: "linear-gradient(145deg, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0.04) 100%)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    boxShadow: "0 0 32px rgba(16,185,129,0.1)",
                  }
                : {
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-card)",
                  }
            }
          >
            <div
              className="absolute -bottom-8 -right-8 w-40 h-40 rounded-full pointer-events-none"
              style={{
                background: labStatus.isOpen ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.06)",
                filter: "blur(28px)",
              }}
            />

            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                  SEAR Lab
                </p>
                <p
                  className="text-3xl font-black tracking-tight"
                  style={{ color: labStatus.isOpen ? "#10b981" : "#f87171" }}
                >
                  {labStatus.label}
                </p>
              </div>
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: labStatus.isOpen ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.1)",
                  border: `1px solid ${labStatus.isOpen ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}`,
                }}
              >
                {labStatus.isOpen
                  ? <DoorOpen size={18} style={{ color: "#10b981" }} />
                  : <DoorClosed size={18} style={{ color: "#f87171" }} />
                }
              </div>
            </div>

            <div className="relative space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-md flex items-center justify-center"
                  style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}
                >
                  <Building2 size={11} style={{ color: "#818cf8" }} />
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {labStatus.detail}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-md flex items-center justify-center"
                  style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)" }}
                >
                  <Activity size={11} style={{ color: "#fbbf24" }} />
                </span>
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {labStatus.next}
                </span>
              </div>
            </div>

            {/* Weekly schedule mini-view */}
            <div className="relative">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                Weekly hours
              </p>
              <div className="grid grid-cols-7 gap-0.5">
                {DAY_NAMES.map((day, idx) => {
                  const sched = LAB_SCHEDULE[idx];
                  const isToday = new Date().getDay() === idx;
                  return (
                    <div
                      key={day}
                      className="flex flex-col items-center gap-0.5"
                    >
                      <span
                        className="text-[9px] font-bold"
                        style={{ color: isToday ? "var(--accent)" : "var(--text-muted)" }}
                      >
                        {day}
                      </span>
                      <div
                        className="w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-bold"
                        style={
                          !sched
                            ? { background: "rgba(71,85,105,0.2)", color: "var(--text-muted)" }
                            : isToday
                            ? { background: "var(--accent)", color: "#fff" }
                            : { background: "rgba(16,185,129,0.15)", color: "#34d399" }
                        }
                      >
                        {sched ? `${sched.open}` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>
                Mon–Thu 9–18 · Fri 9–17 · Closed weekends
              </p>
            </div>
          </div>
        </div>

        {/* ── Metrics Strip: 4 equal columns ─────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={Sun}
            label="Solar Production"
            value={Math.round(mergedLatest?.solar_current_power_w ?? 0).toLocaleString()}
            unit="W"
            accent="#ffe600"
            highlight
            sub={`InfluxDB live · ${fmt(pctSolar, 1)}% of load`}
          />
          <StatCard
            icon={Home}
            label="Total Load"
            value={Math.round(acWatts + hwhWatts + 500).toLocaleString()}
            unit="W"
            accent="#0088ff"
            sub="AC + Water Htr + Base"
          />
          <StatCard
            icon={Thermometer}
            label="Indoor Temp"
            value={indoorTempC != null ? fmt(indoorTempC, 1) : fmt(latest?.ac_current_temp_f ?? 0)}
            unit={indoorTempC != null ? "°C" : "°F"}
            accent="#22d3ee"
            sub={
              targetTempC != null
                ? `Target ${fmt(targetTempC, 1)} °C · InfluxDB`
                : `Target ${fmt(latest?.ac_target_temp_f ?? 0)} °F`
            }
          />
          <StatCard
            icon={Droplets}
            label="Water Heater"
            value={
              influx?.hwh_set_point_c != null
                ? fmt(influx.hwh_set_point_c, 1)
                : fmt(latest?.hwh_set_point_f ?? 0)
            }
            unit={influx?.hwh_set_point_c != null ? "°C" : "°F"}
            accent="#ff6600"
            sub={`Set point · ${Math.round(hwhWatts)} W draw`}
          />
        </div>

        {/* ── Main Grid: Chart (2/3) + Side Panel (1/3) ──────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">

          {/* ── Area Chart Panel ──────────────────────────────────────────── */}
          <div
            className="rounded-2xl p-5"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  <Activity size={14} style={{ color: "var(--accent)" }} />
                  Energy Trends
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(59,130,246,0.12)", color: "var(--accent)", border: "1px solid rgba(59,130,246,0.25)" }}
                  >
                    {influxLive ? "3h · 30s resolution" : "24h"}
                  </span>
                </h2>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {influxLive ? "Live InfluxDB stream" : "Postgres history"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {[
                  { label: "Solar",       color: "#ffe600" },
                  { label: "Net Balance", color: "#34d399" },
                  { label: "HVAC",        color: "#0088ff" },
                  { label: "Water Htr",   color: "#ff6600" },
                ].map(({ label, color }) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-1.5 rounded-sm" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {isLoading && (
              <div className="h-64 flex flex-col items-center justify-center gap-3">
                <div
                  className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: "#fbbf24", borderTopColor: "transparent" }}
                />
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading energy data…</p>
              </div>
            )}

            {!isLoading && chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <ChartDefs />
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(v)
                    }
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="Solar"
                    stroke="#ffe600"
                    strokeWidth={2.5}
                    fill="url(#gradSolar)"
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 5, fill: "#ffe600", strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Net Balance"
                    stroke="#34d399"
                    strokeWidth={2}
                    fill="url(#gradNet)"
                    strokeDasharray="4 2"
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 5, fill: "#34d399", strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="HVAC"
                    stroke="#0088ff"
                    strokeWidth={2}
                    fill="url(#gradHvac)"
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 5, fill: "#0088ff", strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Water Htr"
                    stroke="#ff6600"
                    strokeWidth={2}
                    fill="url(#gradHwh)"
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 5, fill: "#ff6600", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}

            {!isLoading && chartData.length === 0 && (
              <div className="h-64 flex flex-col items-center justify-center gap-2">
                <Activity size={32} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No historical data yet
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                  Start the HVAC collector to see trends
                </p>
              </div>
            )}
          </div>

          {/* ── Side Panel ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3">

            {/* Appliance Status */}
            <div
              className="rounded-2xl p-4"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <h3 className="text-sm font-bold flex items-center gap-2 mb-3" style={{ color: "var(--text-primary)" }}>
                <Plug size={14} style={{ color: "var(--accent)" }} />
                Appliance Status
              </h3>
              <div className="space-y-2">
                <ApplianceRow
                  icon={Wind}
                  label="AC Unit"
                  watts={acWatts}
                  iconColor={acOn ? "#0088ff" : undefined}
                  status={
                    <StatusDot
                      on={acOn}
                      label={latest?.ac_operation_mode ?? "COOL"}
                      color="#0088ff"
                    />
                  }
                />
                <ApplianceRow
                  icon={Flame}
                  label="Water Heater"
                  watts={hwhWatts}
                  iconColor={hwhOn ? "#ff6600" : undefined}
                  status={<StatusDot on={hwhOn} label="HEATING" color="#ff6600" />}
                />
                <ApplianceRow
                  icon={Zap}
                  label="Base Load"
                  watts={500}
                  iconColor="#94a3b8"
                  status={<StatusDot on={true} label="ON" color="#94a3b8" />}
                />
                <ApplianceRow
                  icon={Sun}
                  label="Solar System"
                  watts={mergedLatest?.solar_current_power_w ?? 0}
                  iconColor="#ffe600"
                  status={
                    <StatusDot
                      on={(mergedLatest?.solar_current_power_w ?? 0) > 0}
                      label="ON"
                      color="#ffe600"
                    />
                  }
                />
              </div>
            </div>

            {/* System Insights */}
            <div
              className="rounded-2xl p-4 flex-1"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <h3 className="text-sm font-bold flex items-center gap-2 mb-3" style={{ color: "var(--text-primary)" }}>
                <Brain size={14} style={{ color: "#a78bfa" }} />
                System Insights
              </h3>

              <div
                className="rounded-xl px-3 py-3 space-y-2 mb-3"
                style={{
                  background: "rgba(139,92,246,0.06)",
                  border: "1px solid rgba(139,92,246,0.15)",
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: "rgba(251,191,36,0.12)",
                      border: "1px solid rgba(251,191,36,0.25)",
                    }}
                  >
                    <Zap size={12} style={{ color: "#fbbf24" }} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                      {latest?.overall_recommendation ?? (isLoading ? "Loading…" : "System Optimal")}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                      {latest?.recommendation_reason ?? (isLoading ? "" : "Maintaining stable operation")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tank health */}
              {latest && (latest.hwh_tank_health != null || latest.hwh_compressor_health != null) && (
                <div className="space-y-2">
                  <p
                    className="text-[10px] uppercase tracking-wider font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Tank Health
                  </p>
                  {latest.hwh_tank_health != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: "var(--text-secondary)" }}>Tank</span>
                        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                          {fmt(latest.hwh_tank_health, 0)}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "var(--border-card)" }}>
                        <div
                          className="h-1.5 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, latest.hwh_tank_health)}%`,
                            background:
                              latest.hwh_tank_health > 60
                                ? "#34d399"
                                : latest.hwh_tank_health > 30
                                ? "#fbbf24"
                                : "#f87171",
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {latest.hwh_compressor_health != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: "var(--text-secondary)" }}>Compressor</span>
                        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                          {fmt(latest.hwh_compressor_health, 0)}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "var(--border-card)" }}>
                        <div
                          className="h-1.5 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, latest.hwh_compressor_health)}%`,
                            background:
                              latest.hwh_compressor_health > 60
                                ? "#34d399"
                                : latest.hwh_compressor_health > 30
                                ? "#fbbf24"
                                : "#f87171",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── Today's Summary Bar ─────────────────────────────────────────── */}
        <div
          className="grid grid-cols-3 gap-3 rounded-2xl p-5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          {/* Solar Peak */}
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center mb-1"
              style={{ background: "rgba(255,230,0,0.12)", border: "1px solid rgba(255,230,0,0.2)" }}
            >
              <Sun size={15} style={{ color: "#ffe600" }} />
            </div>
            <p
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              Solar Peak Today
            </p>
            <p className="text-xl font-black tabular-nums" style={{ color: "#fbbf24" }}>
              {displaySolarPeak.toLocaleString()} W
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {influxSolarPeak != null ? "InfluxDB derived" : "Postgres stats"}
            </p>
          </div>

          {/* Avg Load */}
          <div
            className="flex flex-col items-center gap-1.5 text-center"
            style={{
              borderLeft: "1px solid var(--border-card)",
              borderRight: "1px solid var(--border-card)",
            }}
          >
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center mb-1"
              style={{ background: "rgba(0,136,255,0.12)", border: "1px solid rgba(0,136,255,0.2)" }}
            >
              <Activity size={15} style={{ color: "#0088ff" }} />
            </div>
            <p
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              Avg Load
            </p>
            <p className="text-xl font-black tabular-nums" style={{ color: "#60a5fa" }}>
              {displayAvgLoad.toLocaleString()} W
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {influxAvgLoad != null ? "InfluxDB derived" : "Postgres stats"}
            </p>
          </div>

          {/* Energy Efficiency */}
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center mb-1"
              style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.2)" }}
            >
              <TrendingUp size={15} style={{ color: "#34d399" }} />
            </div>
            <p
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              Energy Efficiency
            </p>
            <p className="text-xl font-black tabular-nums" style={{ color: "#34d399" }}>
              {displayAvgLoad > 0
                ? `${Math.round(Math.min(100, (displaySolarPeak / displayAvgLoad) * 100))}%`
                : "—"}
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Solar % of avg load
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
