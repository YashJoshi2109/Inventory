import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
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
} from "lucide-react";
import { energyApi, type EnergyLatest, type InfluxLiveData } from "@/api/energy";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
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
  badge,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  sub?: React.ReactNode;
  accent: string;
  highlight?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div
      className="relative flex flex-col gap-2 rounded-2xl p-4 overflow-hidden"
      style={{
        background: highlight
          ? `linear-gradient(135deg, ${accent}22, ${accent}10)`
          : "var(--bg-card)",
        border: `1px solid ${accent}${highlight ? "40" : "18"}`,
        boxShadow: highlight ? `0 0 28px ${accent}20` : undefined,
      }}
    >
      {/* Glow blob */}
      <div
        className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full pointer-events-none"
        style={{ background: `${accent}15`, filter: "blur(16px)" }}
      />

      <div className="flex items-center justify-between">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${accent}20`, border: `1px solid ${accent}30` }}
        >
          <Icon size={15} style={{ color: accent }} />
        </div>
        {badge}
      </div>

      <div className="flex items-end gap-1">
        <span className="text-2xl font-black tabular-nums leading-none" style={{ color: "var(--text-primary)" }}>
          {value}
        </span>
        {unit && (
          <span className="text-sm font-semibold mb-0.5" style={{ color: accent }}>
            {unit}
          </span>
        )}
      </div>

      <div className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>{label}</div>
      {sub && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

function SurplusBadge({ status }: { status: "SURPLUS" | "DEFICIT" | "UNKNOWN" }) {
  if (status === "SURPLUS") {
    return (
      <span
        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}
      >
        <TrendingUp size={10} /> SURPLUS
      </span>
    );
  }
  if (status === "DEFICIT") {
    return (
      <span
        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
      >
        <TrendingDown size={10} /> DEFICIT
      </span>
    );
  }
  return null;
}

function StatusDot({ on, label, color }: { on: boolean; label: string; color: string }) {
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
      style={
        on
          ? { background: `${color}18`, color, border: `1px solid ${color}40` }
          : { background: "var(--bg-card)", color: "var(--text-muted)", border: "1px solid var(--border-card)" }
      }
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? color : "#475569" }} />
      {on ? label : "OFF"}
    </span>
  );
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-2xl p-3 text-xs space-y-1.5 min-w-[160px]"
      style={{
        background: "var(--bg-topbar)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(24px) saturate(1.8)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      }}
    >
      <p className="font-bold mb-2" style={{ color: "var(--text-primary)" }}>{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-bold" style={{ color: "var(--text-primary)" }}>{Math.round(p.value)} W</span>
        </div>
      ))}
    </div>
  );
}

// ── Appliance Row ─────────────────────────────────────────────────────────────

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
      className="flex items-center justify-between py-2.5 px-3 rounded-xl"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--bg-card)" }}
        >
          <Icon size={13} style={{ color: iconColor ?? "#64748b" }} />
        </div>
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{label}</p>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{Math.round(watts)} W</p>
        </div>
      </div>
      {status}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EnergyDashboard() {
  const { data, isLoading, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["energy-dashboard"],
    queryFn: () => energyApi.getDashboard(24),
    refetchInterval: 15_000,   // poll every 15 s (same as HVAC collector)
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

  const influxLive  = influxData?.live === true;
  const anyLive     = influxLive || !!data?.live;
  const indoorTempC = influxData?.latest?.ac_current_temp_c ?? null;

  // Merge: InfluxDB overrides Postgres for solar + net where non-null
  const mergedLatest = latest
    ? {
        ...latest,
        solar_current_power_w:
          influxData?.latest?.solar_current_power_w ?? latest.solar_current_power_w,
        net_balance_w:
          influxData?.latest?.net_balance_w ?? latest.net_balance_w,
      }
    : latest;

  // Build chart dataset — prefer InfluxDB (30s resolution) over Postgres (5-min)
  const chartData = useMemo(() => {
    if (influxData?.history?.labels?.length) {
      return influxData.history.labels.map((label, i) => ({
        label,
        Solar:         influxData.history.solar[i] ?? 0,
        "Net Balance": influxData.history.net[i] ?? 0,
      }));
    }
    if (!history?.labels) return [];
    return history.labels.map((label, i) => ({
      label,
      Solar:       history.solar[i] ?? 0,
      "HVAC":      history.ac[i] ?? 0,
      "Water Htr": history.hwh[i] ?? 0,
      Total:       history.consumption[i] ?? 0,
    }));
  }, [history, influxData]);

  const pctSolar = mergedLatest
    ? solarPercent(mergedLatest.solar_current_power_w, mergedLatest.total_consumption_w)
    : 0;

  const acOn = AC_ON(latest?.ac_power_mode ?? null);
  const hwhOn = !!(latest?.hwh_running || (latest?.hwh_consumption_w ?? 0) > 100);

  const syncTime = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-full pb-6"
      style={{ background: "var(--bg-page)", color: "var(--text-primary)" }}
    >
      {/* ── Page header ── */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 mb-5"
        style={{
          background: "var(--bg-topbar)",
          backdropFilter: "blur(24px) saturate(1.8)",
          borderBottom: "1px solid rgba(255,230,0,0.1)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#d97706,#fbbf24)", boxShadow: "0 0 20px rgba(251,191,36,0.35)" }}
          >
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight" style={{ color: "var(--text-primary)" }}>
              Eco<span style={{ color: "#fbbf24" }}>Energy</span> Hub
            </h1>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>SEAR Lab · Real-time monitoring</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium"
            style={{
              background: anyLive ? "rgba(52,211,153,0.08)" : "rgba(239,68,68,0.08)",
              border: `1px solid ${anyLive ? "rgba(52,211,153,0.25)" : "rgba(239,68,68,0.25)"}`,
              color: anyLive ? "#34d399" : "#f87171",
            }}
          >
            {anyLive ? <Wifi size={11} /> : <WifiOff size={11} />}
            {influxLive
              ? `InfluxDB · ${syncTime}`
              : data?.live
              ? `Live · ${syncTime}`
              : "No data"}
          </div>

          <button
            onClick={() => void refetch()}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
            title="Refresh"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="px-4 space-y-4">

        {/* ── Error state ── */}
        {isError && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-300">
              Could not load energy data. Make sure the backend is reachable and the{" "}
              <code className="text-red-200 text-xs">energy_readings</code> table exists in Supabase.
            </p>
          </div>
        )}

        {/* ── No-data state ── */}
        {!isLoading && data?.live === false && !isError && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)" }}
          >
            <AlertTriangle size={16} className="text-amber-400 shrink-0" />
            <p className="text-sm text-amber-300">
              No readings yet. Start the HVAC Python collector (
              <code className="text-amber-200 text-xs">python3 run_live.py</code>
              ) to begin streaming data.
            </p>
          </div>
        )}

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
          <StatCard
            icon={Sun}
            label="Solar Powered"
            value={fmt(pctSolar, 1)}
            unit="%"
            accent="#ffe600"
            highlight
            sub="Of direct load"
          />
          <StatCard
            icon={Sun}
            label="Solar Production"
            value={fmt(mergedLatest?.solar_current_power_w ?? 0)}
            unit="W"
            accent="#ffe600"
            sub={<>Peak today: <strong style={{ color: "#ffe600" }}>{fmt(stats?.solar_peak_today ?? 0)} W</strong></>}
          />
          <StatCard
            icon={Home}
            label="Total Consumption"
            value={fmt(latest?.total_consumption_w ?? 0)}
            unit="W"
            accent="#0088ff"
            sub="AC + HWH + Base"
          />
          <StatCard
            icon={Activity}
            label="Net Energy Balance"
            value={fmt(Math.abs(mergedLatest?.net_balance_w ?? 0))}
            unit="W"
            accent={(mergedLatest?.net_balance_w ?? 0) >= 0 ? "#34d399" : "#f87171"}
            highlight={(mergedLatest?.net_balance_w ?? 0) !== 0}
            badge={stats && <SurplusBadge status={stats.savings_status} />}
          />
          <StatCard
            icon={Wind}
            label="AC Temperature"
            value={fmt(latest?.ac_current_temp_f ?? 0)}
            unit="°F"
            accent="#0088ff"
            sub={<>Target: <strong style={{ color: "#0088ff" }}>{fmt(latest?.ac_target_temp_f ?? 0)} °F</strong></>}
          />
          <StatCard
            icon={Thermometer}
            label="Indoor Temp"
            value={indoorTempC != null ? fmt(indoorTempC, 1) : "—"}
            unit="°C"
            accent="#06b6d4"
            sub="AC sensor · live"
          />
          <StatCard
            icon={Droplets}
            label="Water Heater"
            value={fmt(latest?.hwh_set_point_f ?? 0)}
            unit="°F"
            accent="#ff6600"
            sub="Set point"
          />
        </div>

        {/* ── Chart + Side Panel ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">

          {/* Chart */}
          <div
            className="rounded-2xl p-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <Activity size={14} className="text-brand-400" />
                Energy Trends (24h)
              </h2>
              {/* Legend */}
              <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {[
                  { label: "Solar", color: "#ffe600" },
                  { label: "HVAC",  color: "#0088ff" },
                  { label: "HWH",   color: "#ff6600" },
                  { label: "Total", color: "rgba(255,255,255,0.35)" },
                ].map(({ label, color }) => (
                  <span key={label} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {isLoading && (
              <div className="h-64 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
              </div>
            )}

            {!isLoading && chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
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
                    width={48}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="Solar"
                    stroke="#ffe600"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5, fill: "#ffe600" }}
                  />
                  {influxLive ? (
                    <Line
                      type="monotone"
                      dataKey="Net Balance"
                      stroke="#34d399"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      dot={false}
                      activeDot={{ r: 5, fill: "#34d399" }}
                    />
                  ) : (
                    <>
                      <Line
                        type="monotone"
                        dataKey="HVAC"
                        stroke="#0088ff"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5, fill: "#0088ff" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Water Htr"
                        stroke="#ff6600"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        activeDot={{ r: 5, fill: "#ff6600" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Total"
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth={2}
                        strokeDasharray="2 4"
                        dot={false}
                        activeDot={{ r: 5, fill: "rgba(255,255,255,0.6)" }}
                      />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}

            {!isLoading && chartData.length === 0 && (
              <div className="h-64 flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
                No historical data yet
              </div>
            )}
          </div>

          {/* Side panel */}
          <div className="flex flex-col gap-3">

            {/* System Insights */}
            <div
              className="rounded-2xl p-4 flex-1"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <h3 className="text-sm font-bold flex items-center gap-2 mb-3" style={{ color: "var(--text-primary)" }}>
                <Brain size={14} className="text-purple-400" />
                System Insights
              </h3>
              <div
                className="rounded-xl px-3 py-3 space-y-2"
                style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)" }}
                  >
                    <Zap size={12} className="text-amber-400" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {latest?.overall_recommendation ?? (isLoading ? "Loading…" : "System Optimal")}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                      {latest?.recommendation_reason ?? (isLoading ? "" : "Maintaining stable operation")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Health indicators (HWH) */}
              {latest && (latest.hwh_tank_health != null || latest.hwh_compressor_health != null) && (
                <div className="mt-3 space-y-2">
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>Tank Health</p>
                  {latest.hwh_tank_health != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: "var(--text-secondary)" }}>Tank</span>
                        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(latest.hwh_tank_health, 0)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "var(--border-card)" }}>
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, latest.hwh_tank_health)}%`,
                            background: latest.hwh_tank_health > 60 ? "#34d399" : latest.hwh_tank_health > 30 ? "#fbbf24" : "#f87171",
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {latest.hwh_compressor_health != null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: "var(--text-secondary)" }}>Compressor</span>
                        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(latest.hwh_compressor_health, 0)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "var(--border-card)" }}>
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, latest.hwh_compressor_health)}%`,
                            background: latest.hwh_compressor_health > 60 ? "#34d399" : latest.hwh_compressor_health > 30 ? "#fbbf24" : "#f87171",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Appliance Status */}
            <div
              className="rounded-2xl p-4"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <h3 className="text-sm font-bold flex items-center gap-2 mb-3" style={{ color: "var(--text-primary)" }}>
                <Plug size={14} className="text-brand-400" />
                Appliance Status
              </h3>
              <div className="space-y-2">
                <ApplianceRow
                  icon={Wind}
                  label="AC Unit"
                  watts={latest?.ac_consumption_w ?? 0}
                  iconColor={acOn ? "#0088ff" : undefined}
                  status={
                    <StatusDot
                      on={acOn}
                      label={latest?.ac_operation_mode ?? "ON"}
                      color="#0088ff"
                    />
                  }
                />
                <ApplianceRow
                  icon={Flame}
                  label="Water Heater"
                  watts={latest?.hwh_consumption_w ?? 0}
                  iconColor={hwhOn ? "#ff6600" : undefined}
                  status={<StatusDot on={hwhOn} label="HEATING" color="#ff6600" />}
                />
                <ApplianceRow
                  icon={Zap}
                  label="Base Load"
                  watts={500}
                  status={<StatusDot on={false} label="" color="#94a3b8" />}
                />
                <ApplianceRow
                  icon={Sun}
                  label="Solar System"
                  watts={latest?.solar_current_power_w ?? 0}
                  iconColor="#ffe600"
                  status={
                    <StatusDot
                      on={(latest?.solar_current_power_w ?? 0) > 0}
                      label="ON"
                      color="#ffe600"
                    />
                  }
                />
              </div>
            </div>

          </div>
        </div>

        {/* ── Today's summary stats bar ── */}
        {stats && (
          <div
            className="grid grid-cols-3 gap-3 rounded-2xl p-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Solar Peak Today</p>
              <p className="text-lg font-black text-amber-400">{fmt(stats.solar_peak_today)} W</p>
            </div>
            <div className="text-center" style={{ borderLeft: "1px solid var(--border-card)", borderRight: "1px solid var(--border-card)" }}>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Avg Consumption</p>
              <p className="text-lg font-black text-blue-400">{fmt(stats.total_consumption_avg)} W</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Energy Status</p>
              <div className="flex justify-center mt-1">
                <SurplusBadge status={stats.savings_status} />
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
