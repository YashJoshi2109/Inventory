import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { aiApi } from "@/api/transactions";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { BrainCircuit, Search, TrendingDown, Calendar, Zap } from "lucide-react";
import { clsx } from "clsx";
import { useDebounce } from "@/hooks/useDebounce";

export function AiInsights() {
  const [searchQuery, setSearchQuery] = useState("");
  const [forecastItemId, setForecastItemId] = useState<number | null>(null);
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

          {searchLoading && (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" rounded="xl" />
              ))}
            </div>
          )}

          {searchResults && searchResults.hits.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{searchResults.total} matches</p>
              {(searchResults.hits as Array<{
                id: number; sku: string; name: string; category: string | null;
                total_quantity: number; unit: string; score: number;
              }>).map((hit) => (
                <div
                  key={hit.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface hover:bg-surface-hover cursor-pointer transition-colors"
                  onClick={() => setForecastItemId(hit.id)}
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
            <p className="mt-4 text-sm text-slate-500 text-center">No matches found. Try different terms.</p>
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
    </div>
  );
}
