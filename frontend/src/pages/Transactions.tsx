import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { format } from "date-fns";
import {
  ClipboardList,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Activity,
  ChevronLeft,
  ChevronRight,
  Package,
  RefreshCw,
  ArrowRight,
  Filter,
} from "lucide-react";
import { clsx } from "clsx";
import type { InventoryEvent, EventKind } from "@/types";

// ─── Event Config ──────────────────────────────────────────────────────────────
const EVENT_CONFIG: Record<
  EventKind,
  {
    label: string;
    icon: React.ElementType;
    color: string;
    textColor: string;
    bgColor: string;
    borderColor: string;
    sign: "+" | "-" | "~";
  }
> = {
  STOCK_IN: {
    label: "Stock In",
    icon: ArrowUpRight,
    color: "#34d399",
    textColor: "text-emerald-400",
    bgColor: "rgba(52,211,153,0.08)",
    borderColor: "rgba(52,211,153,0.4)",
    sign: "+",
  },
  STOCK_OUT: {
    label: "Stock Out",
    icon: ArrowDownRight,
    color: "#f87171",
    textColor: "text-red-400",
    bgColor: "rgba(248,113,113,0.08)",
    borderColor: "rgba(248,113,113,0.4)",
    sign: "-",
  },
  TRANSFER: {
    label: "Transfer",
    icon: ArrowLeftRight,
    color: "#60a5fa",
    textColor: "text-blue-400",
    bgColor: "rgba(96,165,250,0.08)",
    borderColor: "rgba(96,165,250,0.4)",
    sign: "~",
  },
  ADJUSTMENT: {
    label: "Adjustment",
    icon: Activity,
    color: "#c084fc",
    textColor: "text-purple-400",
    bgColor: "rgba(192,132,252,0.08)",
    borderColor: "rgba(192,132,252,0.4)",
    sign: "~",
  },
  CYCLE_COUNT: {
    label: "Cycle Count",
    icon: RefreshCw,
    color: "#94a3b8",
    textColor: "text-slate-400",
    bgColor: "rgba(148,163,184,0.08)",
    borderColor: "rgba(148,163,184,0.3)",
    sign: "~",
  },
  IMPORT: {
    label: "Import",
    icon: Package,
    color: "#fbbf24",
    textColor: "text-amber-400",
    bgColor: "rgba(251,191,36,0.08)",
    borderColor: "rgba(251,191,36,0.4)",
    sign: "+",
  },
};

// ─── Filter options ────────────────────────────────────────────────────────────
const FILTER_OPTIONS: { label: string; value: string; icon: React.ElementType }[] = [
  { label: "All", value: "", icon: Filter },
  { label: "In", value: "STOCK_IN", icon: ArrowUpRight },
  { label: "Out", value: "STOCK_OUT", icon: ArrowDownRight },
  { label: "Transfer", value: "TRANSFER", icon: ArrowLeftRight },
  { label: "Adjustment", value: "ADJUSTMENT", icon: Activity },
  { label: "Import", value: "IMPORT", icon: Package },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function formatOccurredAt(dateStr: string): string {
  try {
    return format(new Date(dateStr), "MMM d, HH:mm");
  } catch {
    return dateStr;
  }
}

function getQtyDisplay(event: InventoryEvent): { label: string; positive: boolean | null } {
  const cfg = EVENT_CONFIG[event.event_kind];
  if (cfg.sign === "+") return { label: `+${event.quantity}`, positive: true };
  if (cfg.sign === "-") return { label: `-${event.quantity}`, positive: false };
  return { label: `${event.quantity}`, positive: null };
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────
function TransactionSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 animate-pulse"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/5 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-white/5 rounded-full w-2/3" />
              <div className="h-2.5 bg-white/5 rounded-full w-1/3" />
            </div>
            <div className="w-12 h-8 bg-white/5 rounded-lg shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Mobile card ───────────────────────────────────────────────────────────────
function MobileCard({ event, index }: { event: InventoryEvent; index: number }) {
  const cfg = EVENT_CONFIG[event.event_kind] ?? EVENT_CONFIG.STOCK_IN;
  const Icon = cfg.icon;
  const qty = getQtyDisplay(event);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.03 }}
      className="relative overflow-hidden rounded-xl border"
      style={{
        background: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.07)",
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl"
        style={{ background: cfg.color }}
      />

      <div className="pl-4 pr-4 py-3.5 flex items-start gap-3">
        {/* Icon circle */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: cfg.bgColor, border: `1px solid ${cfg.borderColor}` }}
        >
          <Icon size={15} style={{ color: cfg.color }} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Row 1: item name + qty badge */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-100 truncate leading-tight">
              {event.item_name}
            </span>
            <span
              className={clsx(
                "shrink-0 text-xs font-bold px-2 py-0.5 rounded-md",
                qty.positive === true && "text-emerald-400 bg-emerald-400/10",
                qty.positive === false && "text-red-400 bg-red-400/10",
                qty.positive === null && "text-slate-300 bg-white/5"
              )}
            >
              {qty.label}
            </span>
          </div>

          {/* Row 2: SKU + event type badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
              {event.item_sku}
            </span>
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full"
              style={{ color: cfg.color, background: cfg.bgColor }}
            >
              {cfg.label}
            </span>
          </div>

          {/* Row 3: location + time */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-[11px] text-slate-500">
              {event.from_location_code && event.to_location_code ? (
                <>
                  <span className="text-slate-400">{event.from_location_code}</span>
                  <ArrowRight size={10} className="text-slate-600" />
                  <span className="text-slate-400">{event.to_location_code}</span>
                </>
              ) : event.to_location_code ? (
                <span className="text-slate-400">{event.to_location_code}</span>
              ) : event.from_location_code ? (
                <span className="text-slate-400">{event.from_location_code}</span>
              ) : null}
            </div>
            <span className="text-[11px] text-slate-500 shrink-0">
              {formatOccurredAt(event.occurred_at)}
            </span>
          </div>

          {/* Row 4: reference / borrower (optional) */}
          {(event.reference || event.borrower) && (
            <div className="text-[11px] text-slate-500 italic truncate">
              {event.reference && <span>Ref: {event.reference}</span>}
              {event.reference && event.borrower && " · "}
              {event.borrower && <span>By: {event.borrower}</span>}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Desktop table row ─────────────────────────────────────────────────────────
function TableRow({ event, index }: { event: InventoryEvent; index: number }) {
  const cfg = EVENT_CONFIG[event.event_kind] ?? EVENT_CONFIG.STOCK_IN;
  const Icon = cfg.icon;
  const qty = getQtyDisplay(event);

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className="group transition-colors"
      style={{
        background: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
      }}
    >
      {/* Type */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: cfg.bgColor }}
          >
            <Icon size={13} style={{ color: cfg.color }} />
          </div>
          <span
            className="text-xs font-medium"
            style={{ color: cfg.color }}
          >
            {cfg.label}
          </span>
        </div>
      </td>

      {/* Item */}
      <td className="px-4 py-3 max-w-[180px]">
        <span className="text-sm text-slate-200 truncate block">{event.item_name}</span>
      </td>

      {/* SKU */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-xs text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
          {event.item_sku}
        </span>
      </td>

      {/* Qty */}
      <td className="px-4 py-3 whitespace-nowrap text-center">
        <span
          className={clsx(
            "text-sm font-bold",
            qty.positive === true && "text-emerald-400",
            qty.positive === false && "text-red-400",
            qty.positive === null && "text-slate-300"
          )}
        >
          {qty.label}
        </span>
      </td>

      {/* Location */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-1 text-xs text-slate-400">
          {event.from_location_code && event.to_location_code ? (
            <>
              <span>{event.from_location_code}</span>
              <ArrowRight size={10} className="text-slate-600" />
              <span>{event.to_location_code}</span>
            </>
          ) : (
            <span>{event.to_location_code ?? event.from_location_code ?? "—"}</span>
          )}
        </div>
      </td>

      {/* Reference */}
      <td className="px-4 py-3 max-w-[120px]">
        <span className="text-xs text-slate-500 truncate block">
          {event.reference ?? event.borrower ?? "—"}
        </span>
      </td>

      {/* Actor */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-xs text-slate-400">
          {event.actor_username ?? "—"}
        </span>
      </td>

      {/* Time */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-xs text-slate-500">{formatOccurredAt(event.occurred_at)}</span>
      </td>
    </motion.tr>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────────
function EmptyTransactions() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)" }}
      >
        <ClipboardList size={28} className="text-cyan-400" />
      </div>
      <p className="text-base font-semibold text-slate-300 mb-1">No transactions found</p>
      <p className="text-sm text-slate-500">Try adjusting your filter or check back later.</p>
    </motion.div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function Transactions() {
  const [page, setPage] = useState(1);
  const [kindFilter, setKindFilter] = useState("");
  const [jumpValue, setJumpValue] = useState("");
  const PAGE_SIZE = 30;

  const { data, isLoading, isFetching, isError } = useQuery({
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

  const { data: totalsSummary } = useQuery({
    queryKey: ["transactions-summary", { kindFilter }],
    queryFn: async () => {
      const pageSize = 200;
      const first = await transactionsApi.list({
        event_kind: kindFilter || undefined,
        page: 1,
        page_size: pageSize,
      });

      let allItems = [...first.items];
      const maxPages = Math.min(first.total_pages, 25); // safety cap to prevent excessive requests

      for (let p = 2; p <= maxPages; p += 1) {
        const next = await transactionsApi.list({
          event_kind: kindFilter || undefined,
          page: p,
          page_size: pageSize,
        });
        allItems = allItems.concat(next.items);
      }

      return allItems.reduce(
        (acc, e) => {
          const qty = Number(e.quantity) || 0;
          if (e.event_kind === "STOCK_IN" || e.event_kind === "IMPORT") acc.totalIn += qty;
          else if (e.event_kind === "STOCK_OUT") acc.totalOut += qty;
          else if (e.event_kind === "TRANSFER") acc.transfers += qty;
          else if (e.event_kind === "ADJUSTMENT") acc.adjustments += qty;
          return acc;
        },
        { totalIn: 0, totalOut: 0, transfers: 0, adjustments: 0 }
      );
    },
    staleTime: 15_000,
  });

  // Notify on error
  if (isError) {
    toast.error("Failed to load transactions");
  }

  // Fallback stats from current page while summary query loads
  const stats = (() => {
    if (!data?.items) return { totalIn: 0, totalOut: 0, transfers: 0, adjustments: 0 };
    return data.items.reduce(
      (acc, e) => {
        const qty = Number(e.quantity) || 0;
        if (e.event_kind === "STOCK_IN" || e.event_kind === "IMPORT") acc.totalIn += qty;
        else if (e.event_kind === "STOCK_OUT") acc.totalOut += qty;
        else if (e.event_kind === "TRANSFER") acc.transfers += qty;
        else if (e.event_kind === "ADJUSTMENT") acc.adjustments += qty;
        return acc;
      },
      { totalIn: 0, totalOut: 0, transfers: 0, adjustments: 0 }
    );
  })();
  const displayStats = totalsSummary ?? stats;
  const fmtQty = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });

  function handleFilterChange(value: string) {
    setKindFilter(value);
    setPage(1);
    setJumpValue("");
  }

  function handleJump() {
    const n = parseInt(jumpValue, 10);
    if (!isNaN(n) && data && n >= 1 && n <= data.total_pages) {
      setPage(n);
      setJumpValue("");
    }
  }

  return (
    <div
      className="min-h-screen pb-24 lg:pb-6"
      style={{ background: "#030712" }}
    >
      <div className="max-w-7xl mx-auto px-4 lg:px-6 pt-6 space-y-5">

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-4"
        >
          {/* Title row */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: "linear-gradient(135deg, rgba(34,211,238,0.2) 0%, rgba(34,211,238,0.05) 100%)",
                  border: "1px solid rgba(34,211,238,0.3)",
                  boxShadow: "0 0 20px rgba(34,211,238,0.1)",
                }}
              >
                <ClipboardList size={20} className="text-cyan-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white leading-tight">Transactions</h1>
                {data && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {data.total.toLocaleString()} total records
                  </p>
                )}
              </div>
            </div>

            {/* Live badge */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{
                background: "rgba(34,211,238,0.06)",
                border: "1px solid rgba(34,211,238,0.2)",
                color: "#22d3ee",
              }}
            >
              <span
                className={clsx(
                  "w-1.5 h-1.5 rounded-full",
                  isFetching ? "bg-amber-400 animate-pulse" : "bg-emerald-400 animate-pulse"
                )}
              />
              {isFetching ? "Refreshing" : "Live"}
            </div>
          </div>

          {/* Stats chips */}
          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Total In", value: `+${fmtQty(displayStats.totalIn)}`, positive: true },
                { label: "Total Out", value: `-${fmtQty(displayStats.totalOut)}`, positive: false },
                { label: "Transfers", value: fmtQty(displayStats.transfers), positive: null },
                { label: "Adjustments", value: fmtQty(displayStats.adjustments), positive: null },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl px-3 py-2.5 flex flex-col gap-0.5"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                    {s.label}
                  </span>
                  <span
                    className={clsx(
                      "text-base font-bold",
                      s.positive === true && "text-emerald-400",
                      s.positive === false && "text-red-400",
                      s.positive === null && "text-slate-200"
                    )}
                  >
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* ── Filters ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="sticky top-0 z-10 -mx-4 lg:mx-0 px-4 lg:px-0 py-2"
          style={{ background: "rgba(3,7,18,0.9)", backdropFilter: "blur(12px)" }}
        >
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {FILTER_OPTIONS.map((f) => {
              const active = kindFilter === f.value;
              const FIcon = f.icon;
              return (
                <button
                  key={f.value}
                  onClick={() => handleFilterChange(f.value)}
                  className={clsx(
                    "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0",
                    active
                      ? "text-white"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                  style={
                    active
                      ? {
                          background: "linear-gradient(135deg, rgba(34,211,238,0.25) 0%, rgba(34,211,238,0.1) 100%)",
                          border: "1px solid rgba(34,211,238,0.5)",
                          boxShadow: "0 0 12px rgba(34,211,238,0.15)",
                        }
                      : {
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }
                  }
                >
                  <FIcon size={12} />
                  {f.label}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ── Content ── */}
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TransactionSkeleton />
            </motion.div>
          ) : !data?.items.length ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyTransactions />
            </motion.div>
          ) : (
            <motion.div
              key={`list-${page}-${kindFilter}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Mobile card list */}
              <div className="flex flex-col gap-2.5 lg:hidden">
                {data.items.map((event, i) => (
                  <MobileCard key={event.id} event={event} index={i} />
                ))}
              </div>

              {/* Desktop table */}
              <div
                className="hidden lg:block rounded-2xl overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          borderBottom: "1px solid rgba(255,255,255,0.07)",
                        }}
                      >
                        {["Type", "Item", "SKU", "Qty", "Location", "Reference", "Actor", "Time"].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody
                      className="divide-y"
                      style={{ borderColor: "rgba(255,255,255,0.04)" }}
                    >
                      {data.items.map((event, i) => (
                        <TableRow key={event.id} event={event} index={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              {data.total_pages > 1 && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  {/* Mobile: simple prev/next */}
                  <div className="flex items-center gap-2 lg:hidden">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#94a3b8",
                      }}
                    >
                      <ChevronLeft size={15} /> Prev
                    </button>
                    <span className="text-xs text-slate-400 px-1">
                      {page} / {data.total_pages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                      disabled={page >= data.total_pages}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#94a3b8",
                      }}
                    >
                      Next <ChevronRight size={15} />
                    </button>
                  </div>

                  {/* Desktop: full pagination */}
                  <div className="hidden lg:flex items-center gap-3 w-full justify-center">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#94a3b8",
                      }}
                    >
                      <ChevronLeft size={15} /> Prev
                    </button>

                    <span className="text-sm text-slate-400 px-2">
                      Page{" "}
                      <span className="font-semibold text-slate-200">{page}</span>
                      {" "}of{" "}
                      <span className="font-semibold text-slate-200">{data.total_pages}</span>
                    </span>

                    <button
                      onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                      disabled={page >= data.total_pages}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#94a3b8",
                      }}
                    >
                      Next <ChevronRight size={15} />
                    </button>

                    {/* Jump to page */}
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-xs text-slate-500">Jump to</span>
                      <input
                        type="number"
                        min={1}
                        max={data.total_pages}
                        value={jumpValue}
                        onChange={(e) => setJumpValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleJump()}
                        placeholder={String(page)}
                        className="w-16 px-2 py-1.5 rounded-lg text-sm text-center text-slate-200 outline-none focus:ring-1 focus:ring-cyan-400/40"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }}
                      />
                      <button
                        onClick={handleJump}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{
                          background: "rgba(34,211,238,0.12)",
                          border: "1px solid rgba(34,211,238,0.3)",
                          color: "#22d3ee",
                        }}
                      >
                        Go
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
