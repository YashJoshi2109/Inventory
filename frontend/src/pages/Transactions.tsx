import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { format } from "date-fns";
import { ClipboardList, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Activity, ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import type { InventoryEvent } from "@/types";

const EVENT_CONFIG = {
  STOCK_IN: { label: "Stock In", icon: ArrowUpRight, color: "text-emerald-400", badgeVariant: "success" as const },
  STOCK_OUT: { label: "Stock Out", icon: ArrowDownRight, color: "text-red-400", badgeVariant: "danger" as const },
  TRANSFER: { label: "Transfer", icon: ArrowLeftRight, color: "text-blue-400", badgeVariant: "info" as const },
  ADJUSTMENT: { label: "Adjustment", icon: Activity, color: "text-purple-400", badgeVariant: "purple" as const },
  CYCLE_COUNT: { label: "Cycle Count", icon: Activity, color: "text-slate-400", badgeVariant: "default" as const },
  IMPORT: { label: "Import", icon: ArrowUpRight, color: "text-amber-400", badgeVariant: "warning" as const },
};

export function Transactions() {
  const [page, setPage] = useState(1);
  const [kindFilter, setKindFilter] = useState("");
  const PAGE_SIZE = 30;

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", { page, kindFilter }],
    queryFn: () =>
      transactionsApi.list({
        event_kind: kindFilter || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 animate-fade-in">
      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { label: "All", value: "" },
          { label: "In", value: "STOCK_IN" },
          { label: "Out", value: "STOCK_OUT" },
          { label: "Transfer", value: "TRANSFER" },
          { label: "Adjustment", value: "ADJUSTMENT" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => { setKindFilter(f.value); setPage(1); }}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
              kindFilter === f.value
                ? "bg-brand-600 text-white"
                : "bg-surface-card border border-surface-border text-slate-400 hover:text-white"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {data && (
        <p className="text-xs text-slate-500">{data.total.toLocaleString()} transactions</p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : !data?.items.length ? (
        <EmptyState icon={<ClipboardList size={40} />} title="No transactions found" />
      ) : (
        <>
          <Card>
            <div className="divide-y divide-surface-border/50">
              {data.items.map((event) => (
                <TransactionRow key={event.id} event={event} />
              ))}
            </div>
          </Card>

          {data.total_pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} leftIcon={<ChevronLeft size={14} />}>Prev</Button>
              <span className="text-sm text-slate-400">{page} / {data.total_pages}</span>
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= data.total_pages} rightIcon={<ChevronRight size={14} />}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TransactionRow({ event }: { event: InventoryEvent }) {
  const config = EVENT_CONFIG[event.event_kind] ?? EVENT_CONFIG.IMPORT;
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", `${config.color.replace("text-", "bg-")}/10`)}>
        <Icon size={14} className={config.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200 truncate">{event.item_name}</span>
          <Badge variant={config.badgeVariant} className="text-xs">{config.label}</Badge>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 flex-wrap">
          <span className="font-mono">{event.item_sku}</span>
          {(event.to_location_code || event.from_location_code) && (
            <span>→ {event.to_location_code ?? event.from_location_code}</span>
          )}
          {event.reference && <span>Ref: {event.reference}</span>}
          {event.borrower && <span>By: {event.borrower}</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className={clsx("text-sm font-semibold", config.color)}>
          {["STOCK_IN", "IMPORT"].includes(event.event_kind) ? "+" : "-"}{event.quantity}
        </p>
        <p className="text-xs text-slate-500">
          {format(new Date(event.occurred_at), "MMM d, HH:mm")}
        </p>
      </div>
    </div>
  );
}
