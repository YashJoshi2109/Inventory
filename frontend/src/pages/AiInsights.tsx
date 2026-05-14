import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { aiApi, transactionsApi, dashboardApi } from "@/api/transactions";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import {
  BrainCircuit, Search, TrendingDown, Calendar, Zap, AlertTriangle,
  Sparkles, Package, BarChart3, ArrowUpRight, Activity, ShieldAlert,
  Star, Target, Flame, RefreshCw, ChevronRight, TrendingUp,
} from "lucide-react";
import { clsx } from "clsx";
import { useDebounce } from "@/hooks/useDebounce";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const EXAMPLE_QUERIES = [
  "ethanol for cell culture",
  "PCR tubes low stock",
  "sodium chloride reagent",
  "safety equipment PPE",
  "micropipette tips 200µL",
  "chemicals near expiry",
];

// ── Forecast bar chart ────────────────────────────────────────────────────────
type ForecastResult = {
  item_id: number; item_sku: string; item_name: string;
  method: string; avg_daily_consumption: number;
  forecast_7d: number; forecast_30d: number;
  days_of_stock_remaining: number; reorder_date: string | null;
  confidence: number; message: string;
};

function ForecastChart({ forecast }: { forecast: ForecastResult }) {
  const data = [
    { label: "7-Day", value: parseFloat(forecast.forecast_7d.toFixed(1)), color: "var(--accent)" },
    { label: "30-Day", value: parseFloat(forecast.forecast_30d.toFixed(1)), color: "var(--accent-violet)" },
    { label: "On Hand", value: parseFloat((forecast.avg_daily_consumption * forecast.days_of_stock_remaining).toFixed(1)), color: "var(--accent-success)" },
  ];
  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: "var(--text-muted)" }}
          itemStyle={{ color: "var(--text-primary)" }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Health score ───────────────────────────────────────────────────────────────
function HealthScore({ total, lowStock, outOfStock, alerts }: {
  total: number; lowStock: number; outOfStock: number; alerts: number;
}) {
  const pctOk = total > 0 ? ((total - lowStock - outOfStock) / total) * 100 : 100;
  const score = Math.max(0, Math.min(100, Math.round(pctOk - alerts * 2)));
  const color = score >= 80 ? "var(--accent-success)" : score >= 60 ? "var(--accent-warning)" : "var(--accent-danger)";
  const label = score >= 80 ? "Healthy" : score >= 60 ? "Attention" : "Critical";

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-16 h-16 shrink-0">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border-card)" strokeWidth="6" />
          <circle
            cx="32" cy="32" r="26" fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 26}`}
            strokeDashoffset={`${2 * Math.PI * 26 * (1 - score / 100)}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-base font-bold"
          style={{ color }}>
          {score}
        </span>
      </div>
      <div>
        <p className="text-base font-bold" style={{ color }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Inventory Health Score</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {outOfStock > 0 && <span style={{ color: "var(--accent-danger)" }}>{outOfStock} out of stock · </span>}
          {lowStock > 0 && <span style={{ color: "var(--accent-warning)" }}>{lowStock} low stock · </span>}
          {alerts > 0 && <span style={{ color: "var(--accent-danger)" }}>{alerts} active alerts</span>}
          {outOfStock === 0 && lowStock === 0 && alerts === 0 && (
            <span style={{ color: "var(--accent-success)" }}>All systems nominal</span>
          )}
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function AiInsights() {
  const [searchQuery, setSearchQuery] = useState("");
  const [forecastItemId, setForecastItemId] = useState<number | null>(null);
  const [forecastItemName, setForecastItemName] = useState<string>("");
  const debouncedSearch = useDebounce(searchQuery, 400);

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ["ai-search", debouncedSearch],
    queryFn: () => aiApi.search(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
    staleTime: 30_000,
  });

  const { data: forecast, isLoading: forecastLoading } = useQuery({
    queryKey: ["forecast", forecastItemId],
    queryFn: () => aiApi.forecast(forecastItemId!),
    enabled: forecastItemId !== null,
  });

  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: transactionsApi.getAlerts,
    staleTime: 60_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: dashboardApi.getStats,
    staleTime: 60_000,
  });

  const activeAlerts = alerts?.filter((a) => !a.is_resolved) ?? [];
  const anomalyAlerts = activeAlerts.filter((a) => a.alert_type === "anomaly");
  const lowStockAlerts = activeAlerts.filter((a) => a.alert_type === "low_stock");

  const handleHitClick = (hitId: number, hitName: string) => {
    setForecastItemId(hitId);
    setForecastItemName(hitName);
  };

  const topConsumed = stats?.top_consumed ?? [];
  const categoryBreakdown = stats?.category_breakdown ?? [];

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 animate-fade-in">
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5 max-w-6xl">
    <div className="space-y-5 min-w-0">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(var(--accent-violet-rgb), 0.12)", border: "1px solid rgba(var(--accent-violet-rgb), 0.25)" }}>
          <BrainCircuit size={20} style={{ color: "var(--accent-violet)" }} />
        </div>
        <div>
          <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>AI Insights</h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Intelligent search, demand forecasting &amp; inventory intelligence
          </p>
        </div>
      </div>

      {/* ── Inventory Intelligence Overview ── */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Activity size={14} style={{ color: "var(--accent)" }} />
            Inventory Intelligence
          </h3>
        </CardHeader>
        <CardContent className="space-y-4">
          {statsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" rounded="xl" />
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-16" rounded="xl" />)}
              </div>
            </div>
          ) : stats ? (
            <>
              <HealthScore
                total={stats.total_items}
                lowStock={stats.items_low_stock}
                outOfStock={stats.items_out_of_stock}
                alerts={stats.active_alerts}
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                {[
                  { label: "Total SKUs", value: stats.total_skus.toLocaleString(), icon: Package, color: "var(--accent)" },
                  { label: "Low Stock", value: stats.items_low_stock, icon: AlertTriangle, color: "var(--accent-warning)" },
                  { label: "Out of Stock", value: stats.items_out_of_stock, icon: ShieldAlert, color: "var(--accent-danger)" },
                  { label: "Active Alerts", value: stats.active_alerts, icon: Zap, color: "var(--accent-violet)" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl p-3 text-center"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                    <Icon size={16} className="mx-auto mb-1.5" style={{ color }} />
                    <p className="text-lg font-bold" style={{ color }}>{value}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{label}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs pt-1"
                style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}>
                <span>{stats.transactions_today} transactions today</span>
                <span>{stats.transactions_this_week} this week</span>
                <span>${Number(stats.total_inventory_value).toLocaleString("en-US", { maximumFractionDigits: 0 })} total value</span>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Top Movers ── */}
      {topConsumed.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Flame size={14} style={{ color: "var(--accent-2)" }} />
              Top Movers
              <span className="ml-auto text-xs font-normal" style={{ color: "var(--text-muted)" }}>Last 30 days</span>
            </h3>
          </CardHeader>
          <CardContent className="p-0">
            {topConsumed.slice(0, 6).map((item, i) => {
              const max = topConsumed[0].total_consumed;
              const pct = Math.round((item.total_consumed / max) * 100);
              return (
                <Link
                  key={item.id}
                  to={`/inventory/${item.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors group"
                  style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span className="text-xs font-mono w-4 text-center shrink-0"
                    style={{ color: i === 0 ? "var(--accent-warning)" : "var(--text-muted)" }}>
                    {i === 0 ? <Star size={12} fill="currentColor" /> : `#${i + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.name}</p>
                    <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: "var(--border-card)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--accent)" }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold" style={{ color: "var(--accent)" }}>{item.total_consumed.toFixed(0)}</p>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>used</p>
                  </div>
                  <ChevronRight size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: "var(--text-muted)" }} />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Category Breakdown ── */}
      {categoryBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <BarChart3 size={14} style={{ color: "var(--accent-cyan)" }} />
              Category Distribution
            </h3>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {categoryBreakdown.slice(0, 8).map((cat) => {
              const total = categoryBreakdown.reduce((s, c) => s + c.count, 0);
              const pct = total > 0 ? Math.round((cat.count / total) * 100) : 0;
              return (
                <div key={cat.id} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.color ?? "var(--accent)" }} />
                  <p className="text-xs flex-1 truncate" style={{ color: "var(--text-secondary)" }}>{cat.name}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-card)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cat.color ?? "var(--accent)" }} />
                    </div>
                    <span className="text-xs w-12 text-right" style={{ color: "var(--text-muted)" }}>
                      {cat.count} ({pct}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Natural Language Search ── */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Search size={14} style={{ color: "var(--accent-violet)" }} />
            Natural Language Search
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            AI-powered TF-IDF search. Ask in plain English — click result to load demand forecast.
          </p>
        </CardHeader>
        <CardContent>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. ethanol for cell culture, PCR tubes, low stock reagents…"
            leftIcon={<Search size={14} />}
          />

          {!debouncedSearch && (
            <div className="mt-4 space-y-3">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Try an example:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => setSearchQuery(q)}
                    className="px-3 py-1.5 rounded-full text-xs transition-all"
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-card)",
                      color: "var(--text-secondary)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-card)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {searchLoading && (
            <div className="mt-4 space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" rounded="xl" />)}
            </div>
          )}

          {searchResults && searchResults.hits.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                {searchResults.total} matches — click to load forecast
              </p>
              {(searchResults.hits as Array<{
                id: number; sku: string; name: string; category: string | null;
                total_quantity: number; unit: string; score: number;
              }>).map((hit) => (
                <div
                  key={hit.id}
                  className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                  style={{
                    background: forecastItemId === hit.id ? "rgba(var(--accent-violet-rgb), 0.10)" : "var(--bg-card)",
                    border: forecastItemId === hit.id ? "1px solid rgba(var(--accent-violet-rgb), 0.35)" : "1px solid var(--border-card)",
                  }}
                  onClick={() => handleHitClick(hit.id, hit.name)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs" style={{ color: "var(--accent)" }}>{hit.sku}</span>
                      {hit.category && (
                        <Badge variant="default" className="text-[10px]">{hit.category}</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-0.5" style={{ color: "var(--text-primary)" }}>{hit.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {hit.total_quantity} {hit.unit} on hand
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Match</div>
                    <div className="text-sm font-bold" style={{ color: "var(--accent-violet)" }}>
                      {(hit.score * 100).toFixed(0)}%
                    </div>
                    <div className="w-12 h-1 rounded-full mt-1 overflow-hidden" style={{ background: "var(--border-card)" }}>
                      <div className="h-full rounded-full" style={{ width: `${hit.score * 100}%`, background: "var(--accent-violet)" }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {searchResults && searchResults.total === 0 && debouncedSearch.length >= 2 && (
            <div className="mt-4 py-6 text-center">
              <Search size={24} className="mx-auto mb-2" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No matches found. Try different terms.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Demand Forecast ── */}
      {forecastItemId && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <TrendingDown size={14} style={{ color: "var(--accent)" }} />
              Demand Forecast
              {forecastItemName && (
                <span className="font-normal text-xs ml-1" style={{ color: "var(--text-muted)" }}>
                  — {forecastItemName}
                </span>
              )}
            </h3>
          </CardHeader>
          <CardContent>
            {forecastLoading ? (
              <div className="space-y-3 py-2">
                <Skeleton className="h-4 w-48" rounded="md" />
                <Skeleton className="h-24 w-full" rounded="xl" />
                <div className="grid grid-cols-2 gap-3">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-14" rounded="xl" />)}
                </div>
              </div>
            ) : forecast ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{forecast.item_name}</p>
                    <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{forecast.item_sku}</p>
                  </div>
                  <Badge variant="purple">
                    <Zap size={10} className="mr-1" />
                    {forecast.method}
                  </Badge>
                </div>

                <ForecastChart forecast={forecast} />

                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: "7-Day Forecast", value: forecast.forecast_7d.toFixed(1), suffix: "units", color: "var(--accent)" },
                    { label: "30-Day Forecast", value: forecast.forecast_30d.toFixed(1), suffix: "units", color: "var(--accent-violet)" },
                    {
                      label: "Days of Stock",
                      value: forecast.days_of_stock_remaining === Infinity ? "∞" : forecast.days_of_stock_remaining.toFixed(0),
                      suffix: "days",
                      color: forecast.days_of_stock_remaining < 14 ? "var(--accent-danger)" : "var(--accent-success)",
                    },
                    { label: "Avg Daily Use", value: forecast.avg_daily_consumption.toFixed(2), suffix: "/day", color: "var(--accent-2)" },
                  ].map(({ label, value, suffix, color }) => (
                    <div key={label} className="rounded-xl p-3"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</p>
                      <p className="text-xl font-bold mt-0.5" style={{ color }}>
                        {value}
                        <span className="text-xs font-normal ml-1" style={{ color: "var(--text-muted)" }}>{suffix}</span>
                      </p>
                    </div>
                  ))}
                </div>

                {forecast.reorder_date && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl"
                    style={{ background: "rgba(var(--accent-warning-rgb), 0.08)", border: "1px solid rgba(var(--accent-warning-rgb), 0.28)" }}>
                    <Calendar size={14} style={{ color: "var(--accent-warning)" }} className="shrink-0" />
                    <p className="text-sm">
                      <span style={{ color: "var(--text-secondary)" }}>Reorder by </span>
                      <strong style={{ color: "var(--accent-warning)" }}>
                        {new Date(forecast.reorder_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </strong>
                    </p>
                  </div>
                )}

                {/* Confidence bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
                    <span>Forecast confidence</span>
                    <span>{(forecast.confidence * 100).toFixed(0)}% — {forecast.message}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border-card)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${forecast.confidence * 100}%`,
                        background: forecast.confidence >= 0.7 ? "var(--accent-success)" : forecast.confidence >= 0.4 ? "var(--accent-warning)" : "var(--accent-danger)",
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ── Low Stock Alerts ── */}
      {lowStockAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <TrendingDown size={14} style={{ color: "var(--accent-warning)" }} />
              Reorder Queue
              <Badge variant="warning" className="ml-auto">{lowStockAlerts.length}</Badge>
            </h3>
          </CardHeader>
          <CardContent className="p-0">
            {lowStockAlerts.slice(0, 5).map((alert, i) => (
              <div key={alert.id}
                className="flex items-start gap-3 px-5 py-3"
                style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--accent-warning)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{alert.item_name ?? "Unknown item"}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{alert.message}</p>
                </div>
                {alert.item_id && (
                  <Link to={`/inventory/${alert.item_id}`} className="shrink-0 p-1 rounded-lg transition-colors"
                    style={{ color: "var(--accent)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
            ))}
            {lowStockAlerts.length > 5 && (
              <div className="px-5 py-3 text-xs" style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}>
                +{lowStockAlerts.length - 5} more low stock items — <Link to="/alerts" className="underline" style={{ color: "var(--accent)" }}>view all alerts</Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Anomaly Detection ── */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Target size={14} style={{ color: "var(--accent-cyan)" }} />
            Anomaly Detection
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Statistical ML flags on unusual inventory activity
          </p>
        </CardHeader>
        <CardContent>
          {anomalyAlerts.length > 0 ? (
            <div className="space-y-2">
              {anomalyAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: "rgba(var(--accent-warning-rgb), 0.07)", border: "1px solid rgba(var(--accent-warning-rgb), 0.22)" }}
                >
                  <Zap size={14} className="mt-0.5 shrink-0" style={{ color: "var(--accent-warning)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {alert.item_name ?? "Unknown item"}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{alert.message}</p>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                    {new Date(alert.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center space-y-2">
              <div className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center"
                style={{ background: "rgba(var(--accent-success-rgb), 0.10)", border: "1px solid rgba(var(--accent-success-rgb), 0.20)" }}>
                <TrendingUp size={18} style={{ color: "var(--accent-success)" }} />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>No anomalies detected</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Continuous ML monitoring is active. Unusual withdrawal patterns will appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Rebuild Index ── */}
      <div className="flex justify-end">
        <button
          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}
          onClick={async () => {
            try {
              await aiApi.rebuildIndex();
              toast_notify("Search index rebuilt");
            } catch { /* silent */ }
          }}
        >
          <RefreshCw size={11} />
          Rebuild search index
        </button>
      </div>
    </div>{/* end left column */}

    {/* ── RIGHT SIDEBAR ── */}
    <div className="space-y-4 hidden xl:block">

      {/* AI Capabilities */}
      <Card>
        <CardHeader>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2"
            style={{ color: "var(--text-muted)" }}>
            <BrainCircuit size={12} style={{ color: "var(--accent-violet)" }} />
            AI Capabilities
          </h3>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { icon: Search, label: "NLP Search", desc: "TF-IDF semantic search across all inventory fields", color: "var(--accent-violet)" },
            { icon: TrendingDown, label: "Demand Forecast", desc: "ML-based 7/30-day consumption forecasts", color: "var(--accent)" },
            { icon: Target, label: "Anomaly Detection", desc: "Statistical outlier detection on usage patterns", color: "var(--accent-cyan)" },
            { icon: Activity, label: "Health Score", desc: "Real-time composite inventory health metric", color: "var(--accent-success)" },
          ].map(({ icon: Icon, label, desc, color }) => (
            <div key={label} className="flex gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: `rgba(var(--accent-violet-rgb), 0.10)`, border: "1px solid rgba(var(--accent-violet-rgb), 0.18)" }}>
                <Icon size={12} style={{ color }} />
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{label}</p>
                <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>{desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Quick Actions - after AI Capabilities */}
      <Card>
        <CardHeader>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2"
            style={{ color: "var(--text-muted)" }}>
            <Sparkles size={12} style={{ color: "var(--accent-violet)" }} />
            Quick Actions
          </h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "View Alerts", href: "/alerts", icon: ShieldAlert, color: "var(--accent-danger)", bg: "rgba(var(--accent-danger-rgb,239,68,68),0.10)" },
              { label: "Inventory", href: "/inventory", icon: Package, color: "var(--accent)", bg: "rgba(var(--accent-rgb),0.10)" },
              { label: "Transactions", href: "/transactions", icon: Activity, color: "var(--accent-violet)", bg: "rgba(var(--accent-violet-rgb,139,92,246),0.10)" },
              { label: "Import Data", href: "/import", icon: ArrowUpRight, color: "var(--accent-cyan)", bg: "rgba(var(--accent-cyan-rgb,34,211,238),0.10)" },
            ].map(({ label, href, icon: Icon, color, bg }) => (
              <Link
                key={href}
                to={href}
                className="flex flex-col items-center gap-2 p-3 rounded-xl text-center transition-all"
                style={{ background: "var(--bg-page)", border: "1px solid var(--border-subtle)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-page)")}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: bg, border: `1px solid ${color}30` }}>
                  <Icon size={16} style={{ color }} />
                </div>
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{label}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Search Tips */}
      <Card>
        <CardHeader>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2"
            style={{ color: "var(--text-muted)" }}>
            <Star size={12} style={{ color: "var(--accent-warning)" }} />
            Search Tips
          </h3>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            "Type partial names — \"ethan\" matches \"Ethanol\"",
            "Include context — \"PCR tubes low\" narrows results",
            "Use chemical names or lab jargon freely",
            "Click any result to load its demand forecast",
          ].map((tip, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[10px] font-bold mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ background: "rgba(var(--accent-warning-rgb), 0.12)", color: "var(--accent-warning)" }}>
                {i + 1}
              </span>
              <p className="text-[10px] leading-snug" style={{ color: "var(--text-secondary)" }}>{tip}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Reorder Queue Summary */}
      {lowStockAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2"
              style={{ color: "var(--text-muted)" }}>
              <AlertTriangle size={12} style={{ color: "var(--accent-warning)" }} />
              Reorder Summary
            </h3>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between p-2.5 rounded-xl"
              style={{ background: "rgba(var(--accent-warning-rgb), 0.08)", border: "1px solid rgba(var(--accent-warning-rgb), 0.22)" }}>
              <div className="text-center flex-1">
                <p className="text-xl font-bold" style={{ color: "var(--accent-warning)" }}>{lowStockAlerts.length}</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Need Reorder</p>
              </div>
              <div className="text-center flex-1" style={{ borderLeft: "1px solid rgba(var(--accent-warning-rgb), 0.20)" }}>
                <p className="text-xl font-bold" style={{ color: "var(--accent-danger)" }}>{anomalyAlerts.length}</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Anomalies</p>
              </div>
            </div>
            <Link
              to="/alerts"
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs transition-colors"
              style={{ border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--accent-warning)";
                (e.currentTarget as HTMLAnchorElement).style.color = "var(--accent-warning)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border-card)";
                (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)";
              }}
            >
              <AlertTriangle size={11} />
              View All Alerts
            </Link>
          </CardContent>
        </Card>
      )}

    </div>
    </div>
    </div>
  );
}

// tiny inline toast helper (avoids import at top)
function toast_notify(msg: string) {
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:9999;background:var(--bg-card-solid);border:1px solid var(--border-card);padding:8px 14px;border-radius:10px;font-size:12px;color:var(--text-primary)";
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
