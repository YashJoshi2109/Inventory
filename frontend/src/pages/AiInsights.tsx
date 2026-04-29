import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { aiApi, transactionsApi } from "@/api/transactions";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { BrainCircuit, Search, TrendingDown, Calendar, Zap, AlertTriangle, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { useDebounce } from "@/hooks/useDebounce";

const EXAMPLE_QUERIES = [
  "ethanol for cell culture",
  "PCR tubes low stock",
  "sodium chloride reagent grade",
  "safety equipment PPE",
  "micropipette tips 200µL",
];

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

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: transactionsApi.getAlerts,
    staleTime: 60_000,
  });

  // Filter only anomaly-type alerts that haven't been resolved
  const anomalyAlerts = alerts?.filter((a) => a.alert_type === "anomaly" && !a.is_resolved) ?? [];

  const handleHitClick = (hitId: number, hitName: string) => {
    setForecastItemId(hitId);
    setForecastItemName(hitName);
  };

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-6 animate-fade-in max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-purple-600/20 rounded-xl flex items-center justify-center">
          <BrainCircuit size={20} className="text-purple-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>AI Insights</h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Intelligent search & demand forecasting</p>
        </div>
      </div>

      {/* NLP Search */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Search size={15} className="text-purple-400" />
            Natural Language Search
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Ask in plain English: "ethanol for cell culture", "PCR tubes", "low reorder reagents"
          </p>
        </CardHeader>
        <CardContent>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Describe what you're looking for…"
            leftIcon={<Search size={15} />}
          />

          {/* Empty state — no query yet */}
          {!debouncedSearch && (
            <div className="mt-5 text-center py-4 space-y-3">
              <div className="w-10 h-10 mx-auto rounded-xl bg-purple-600/10 flex items-center justify-center">
                <Sparkles size={18} className="text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Search your inventory using plain English
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  The AI understands context, synonyms, and categories. Try one of these:
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => setSearchQuery(q)}
                    className="px-3 py-1.5 rounded-full text-xs transition-colors"
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-card)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Click a result to instantly load its demand forecast below.
              </p>
            </div>
          )}

          {searchLoading && (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" rounded="xl" />
              ))}
            </div>
          )}

          {searchResults && searchResults.hits.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{searchResults.total} matches — click to view forecast</p>
              {(searchResults.hits as Array<{
                id: number; sku: string; name: string; category: string | null;
                total_quantity: number; unit: string; score: number;
              }>).map((hit) => (
                <div
                  key={hit.id}
                  className={clsx(
                    "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors",
                    forecastItemId === hit.id
                      ? "bg-purple-600/10 border border-purple-500/40"
                      : "bg-surface hover:bg-surface-hover border border-transparent",
                  )}
                  onClick={() => handleHitClick(hit.id, hit.name)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-brand-400">{hit.sku}</span>
                      {hit.category && <Badge variant="default" className="text-xs">{hit.category}</Badge>}
                    </div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{hit.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{hit.total_quantity} {hit.unit} on hand</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Relevance</div>
                    <div className="text-sm font-medium text-purple-400">{(hit.score * 100).toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {searchResults && searchResults.total === 0 && debouncedSearch.length >= 2 && (
            <p className="mt-4 text-sm text-center" style={{ color: "var(--text-muted)" }}>No matches found. Try different terms.</p>
          )}
        </CardContent>
      </Card>

      {/* Demand Forecast */}
      {forecastItemId && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <TrendingDown size={15} className="text-blue-400" />
              Demand Forecast
              {forecastItemName && (
                <span className="font-normal text-xs ml-1" style={{ color: "var(--text-muted)" }}>— {forecastItemName}</span>
              )}
            </h3>
          </CardHeader>
          <CardContent>
            {forecastLoading ? (
              <div className="space-y-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-40" rounded="md" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-6 w-20" rounded="full" />
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" rounded="xl" />
                ))}
              </div>
            ) : forecast ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{forecast.item_name}</p>
                    <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{forecast.item_sku}</p>
                  </div>
                  <Badge variant="purple">
                    <Zap size={11} className="mr-1" />
                    {forecast.method}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "7-Day Forecast", value: forecast.forecast_7d.toFixed(1), suffix: "units" },
                    { label: "30-Day Forecast", value: forecast.forecast_30d.toFixed(1), suffix: "units" },
                    { label: "Days of Stock", value: forecast.days_of_stock_remaining === Infinity ? "∞" : forecast.days_of_stock_remaining.toFixed(0), suffix: "days" },
                    { label: "Avg Daily Use", value: forecast.avg_daily_consumption.toFixed(2), suffix: "/day" },
                  ].map(({ label, value, suffix }) => (
                    <div key={label} className="bg-surface rounded-xl p-3">
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
                      <p className="text-lg font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{value} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>{suffix}</span></p>
                    </div>
                  ))}
                </div>

                {forecast.reorder_date && (
                  <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                    <Calendar size={15} className="text-amber-400 shrink-0" />
                    <p className="text-sm text-amber-300">
                      Reorder recommended by{" "}
                      <strong>{new Date(forecast.reorder_date).toLocaleDateString()}</strong>
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                  <span>Confidence: {(forecast.confidence * 100).toFixed(0)}%</span>
                  <div className="flex-1 mx-3 h-1.5 bg-surface rounded-full overflow-hidden">
                    <div
                      className={clsx("h-full rounded-full", forecast.confidence >= 0.7 ? "bg-emerald-500" : forecast.confidence >= 0.4 ? "bg-amber-500" : "bg-red-500")}
                      style={{ width: `${forecast.confidence * 100}%` }}
                    />
                  </div>
                  <span>{forecast.message}</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Anomaly Detection */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <AlertTriangle size={15} className="text-amber-400" />
            Anomaly Detection
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Statistical &amp; ML-based flags on unusual inventory activity
          </p>
        </CardHeader>
        <CardContent>
          {alertsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" rounded="xl" />
              ))}
            </div>
          ) : anomalyAlerts.length > 0 ? (
            <div className="space-y-2">
              {anomalyAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-amber-500/25 bg-amber-500/5"
                >
                  <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {alert.item_name ?? "Unknown item"}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {alert.message}
                    </p>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                    {new Date(alert.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center space-y-2">
              <div className="w-9 h-9 mx-auto rounded-xl bg-emerald-600/10 flex items-center justify-center">
                <AlertTriangle size={16} className="text-emerald-400" />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>No anomalies detected</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                The system continuously monitors withdrawals for unusual patterns using statistical and ML-based detection.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
