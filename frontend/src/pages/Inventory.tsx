import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { itemsApi } from "@/api/items";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  Search, Plus, QrCode, Printer,
  ChevronLeft, ChevronRight, Package, FolderPlus,
} from "lucide-react";
import { clsx } from "clsx";
import type { ItemSummary } from "@/types";
import { useHaptic } from "@/hooks/useHaptic";
import { useAuthStore } from "@/store/auth";

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "In Stock", value: "OK" },
  { label: "Low Stock", value: "LOW" },
  { label: "Out of Stock", value: "OUT" },
];

export function Inventory() {
  const { triggerHaptic } = useHaptic();
  const { hasRole } = useAuthStore();
  const canManage = hasRole("admin", "manager");
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  type PrintScope = "current" | "all" | "category" | "low" | "out";
  const [printScope, setPrintScope] = useState<PrintScope>("current");
  const [printCategoryId, setPrintCategoryId] = useState<string>("");
  const [newItem, setNewItem] = useState({
    sku: "",
    name: "",
    category_id: "",
    unit: "pcs",
    unit_cost: "0",
    reorder_level: "0",
  });
  const [newCategory, setNewCategory] = useState({ name: "", description: "" });
  const queryClient = useQueryClient();
  const PAGE_SIZE = 30;

  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const categoryId = searchParams.get("category_id");

  const { data, isLoading } = useQuery({
    queryKey: ["items", { q, status, categoryId, page }],
    queryFn: () =>
      itemsApi.list({
        q: q || undefined,
        status: status || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: itemsApi.getCategories,
    staleTime: 60_000 * 5,
  });

  const setFilter = (key: string, value: string) => {
    setPage(1);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      return itemsApi.create({
        sku: newItem.sku,
        name: newItem.name,
        category_id: newItem.category_id ? Number(newItem.category_id) : undefined,
        unit: newItem.unit,
        unit_cost: Number(newItem.unit_cost),
        reorder_level: Number(newItem.reorder_level),
      });
    },
    onSuccess: () => {
      triggerHaptic("success");
      toast.success("Item created with barcode");
      setShowAddModal(false);
      setNewItem({
        sku: "",
        name: "",
        category_id: "",
        unit: "pcs",
        unit_cost: "0",
        reorder_level: "0",
      });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (err: unknown) => {
      triggerHaptic("error");
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to create item");
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: () => itemsApi.createCategory({
      name: newCategory.name.trim(),
      description: newCategory.description.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success("Category created");
      setShowAddCategoryModal(false);
      setNewCategory({ name: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to create category");
    },
  });

  // ── Bulk-print QR labels for the selected scope ───────────────────────────
  /**
   * Translate a scope choice into the filter params the /print-bulk endpoint accepts.
   * - current:  whatever the user is viewing now (q + status + categoryId)
   * - all:      no filters — entire active inventory
   * - category: just the category picked in the modal
   * - low/out:  status-only filter
   */
  const scopeToParams = (scope: PrintScope): { q?: string; category_id?: number; status?: string } => {
    switch (scope) {
      case "current":
        return {
          q: q || undefined,
          status: status || undefined,
          category_id: categoryId ? Number(categoryId) : undefined,
        };
      case "all":
        return {};
      case "category":
        return { category_id: printCategoryId ? Number(printCategoryId) : undefined };
      case "low":
        return { status: "LOW" };
      case "out":
        return { status: "OUT" };
    }
  };

  const bulkPrintMutation = useMutation({
    mutationFn: (scope: PrintScope) => itemsApi.printBulkLabels(scopeToParams(scope)),
    onSuccess: ({ blob, count }) => {
      triggerHaptic("success");
      // Try new-tab preview first (best UX for Cmd/Ctrl+P). Fall back to download
      // if the popup blocker bites — programmatic open after await loses user-gesture.
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `sear-labels-bulk-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Give the new tab time to load the blob before we revoke.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`${count} label${count === 1 ? "" : "s"} generated`);
      setShowPrintModal(false);
    },
    onError: (err: unknown) => {
      triggerHaptic("error");
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to generate labels");
    },
  });

  /** Rough page estimate for the confirm dialog — Avery 5160 = 30 labels/sheet. */
  const scopeItemEstimate = (scope: PrintScope): number | null => {
    if (scope === "current") return data?.total ?? null;
    // "all" / "category" / "low" / "out" — we don't precompute; backend caps at 2000.
    return null;
  };

  const handleConfirmPrint = () => {
    // Guard: category scope requires a category pick.
    if (printScope === "category" && !printCategoryId) {
      toast.error("Pick a category first");
      return;
    }
    const est = scopeItemEstimate(printScope);
    if (est !== null && est > 60) {
      const pages = Math.ceil(est / 30);
      const ok = window.confirm(
        `Print ${est.toLocaleString()} label${est === 1 ? "" : "s"} (~${pages} page${pages === 1 ? "" : "s"})?`,
      );
      if (!ok) return;
    }
    bulkPrintMutation.mutate(printScope);
  };

  const openPrintModal = () => {
    // Default scope = "current" if any filter is active, else "all".
    const hasFilter = Boolean(q || status || categoryId);
    setPrintScope(hasFilter ? "current" : "all");
    setPrintCategoryId(categoryId ?? "");
    setShowPrintModal(true);
  };

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 animate-fade-in">
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            defaultValue={q}
            onChange={(e) => setFilter("q", e.target.value)}
            placeholder="Search by name, SKU, supplier…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface-card border border-surface-border rounded-lg placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          {canManage && (
            <>
              <Button
                variant="secondary"
                leftIcon={<Printer size={15} />}
                size="md"
                onClick={openPrintModal}
                loading={bulkPrintMutation.isPending}
                title="Bulk-print QR labels (current view, whole inventory, by category, or by stock status)"
              >
                Print Labels
              </Button>
              <Button variant="secondary" leftIcon={<FolderPlus size={15} />} size="md" onClick={() => setShowAddCategoryModal(true)}>
                Category
              </Button>
            </>
          )}
          <Button variant="primary" leftIcon={<Plus size={15} />} size="md" onClick={() => setShowAddModal(true)}>
            Add Item
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter("status", f.value)}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
              status === f.value
                ? "bg-brand-600 text-white"
                : "bg-surface-card border border-surface-border hover:text-white"
            )}
          >
            {f.label}
          </button>
        ))}

        {/* Category filter */}
        {categories && categories.length > 0 && (
          <select
            value={categoryId ?? ""}
            onChange={(e) => setFilter("category_id", e.target.value)}
            className="px-3 py-1.5 rounded-lg text-sm bg-surface-card border border-surface-border focus:outline-none focus:ring-2 focus:ring-brand-500"
            style={{ color: "var(--text-secondary)" }}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Results summary */}
      {data && (
        <div className="flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
          <span>{data.total.toLocaleString()} items</span>
          <span>Page {data.page} of {data.total_pages}</span>
        </div>
      )}

      {/* Table / list */}
      {isLoading ? (
        <SkeletonCard rows={10} />
      ) : !data?.items.length ? (
        <EmptyState
          icon={<Package size={40} />}
          title="No items found"
          description="Try adjusting your search or filters"
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border">
                      {["SKU", "Name", "Category", "On Hand", "Reorder Level", "Unit Cost", "Status", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border/50">
                    {data.items.map((item) => (
                      <ItemRow key={item.id} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-2">
            {data.items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>

          {/* Pagination */}
          {data.total_pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                leftIcon={<ChevronLeft size={15} />}
              >
                Previous
              </Button>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {page} / {data.total_pages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                disabled={page === data.total_pages}
                rightIcon={<ChevronRight size={15} />}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Bulk QR print scope picker ── */}
      <Modal
        open={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        title="Print QR Labels"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowPrintModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              leftIcon={<Printer size={15} />}
              loading={bulkPrintMutation.isPending}
              disabled={printScope === "category" && !printCategoryId}
              onClick={handleConfirmPrint}
            >
              Generate PDF
            </Button>
          </div>
        )}
      >
        <div className="p-5 space-y-3">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Pick what to print. Labels use the Avery 5160 layout (30 per sheet).
          </p>

          {[
            {
              id: "current" as const,
              label: "Current view",
              desc: data
                ? `${data.total.toLocaleString()} item${data.total === 1 ? "" : "s"} matching active search / filters`
                : "Whatever the table is showing right now",
              disabled: !data || data.total === 0,
            },
            {
              id: "all" as const,
              label: "Entire inventory",
              desc: "All active items, no filters (capped at 2000)",
            },
            {
              id: "category" as const,
              label: "By category",
              desc: "Only items in a specific category",
            },
            {
              id: "low" as const,
              label: "Low stock only",
              desc: "Items at or below reorder level",
            },
            {
              id: "out" as const,
              label: "Out of stock only",
              desc: "Items with zero on hand",
            },
          ].map((opt) => {
            const selected = printScope === opt.id;
            const isDisabled = "disabled" in opt && opt.disabled;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={isDisabled}
                onClick={() => setPrintScope(opt.id)}
                className={clsx(
                  "w-full text-left px-4 py-3 rounded-xl border transition-colors",
                  selected
                    ? "bg-brand-600/15 border-brand-500"
                    : "bg-surface-card border-surface-border hover:border-brand-500/50",
                  isDisabled && "opacity-50 cursor-not-allowed",
                )}
                style={{ color: "var(--text-primary)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{opt.label}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{opt.desc}</p>
                  </div>
                  <span
                    className={clsx(
                      "w-4 h-4 rounded-full border-2 shrink-0",
                      selected ? "border-brand-400 bg-brand-500" : "border-slate-600",
                    )}
                  />
                </div>

                {/* Inline category picker — only shown under the "By category" option */}
                {opt.id === "category" && selected && (
                  <select
                    value={printCategoryId}
                    onChange={(e) => setPrintCategoryId(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-3 w-full px-3 py-2 rounded-lg text-sm bg-surface-base border border-surface-border focus:outline-none focus:ring-2 focus:ring-brand-500"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <option value="">— Choose a category —</option>
                    {(categories ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </button>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Item"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createMutation.isPending}
              disabled={!newItem.sku.trim() || !newItem.name.trim()}
              onClick={() => createMutation.mutate()}
            >
              Create Item
            </Button>
          </div>
        )}
      >
        <div className="p-5 space-y-3">
          <Input
            label="SKU"
            placeholder="CHEM-001"
            value={newItem.sku}
            onChange={(e) => setNewItem((p) => ({ ...p, sku: e.target.value.toUpperCase() }))}
          />
          <Input
            label="Name"
            placeholder="Sodium Chloride"
            value={newItem.name}
            onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Unit"
              value={newItem.unit}
              onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value }))}
            />
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Category</label>
              <select
                value={newItem.category_id}
                onChange={(e) => setNewItem((p) => ({ ...p, category_id: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg text-sm bg-surface-card border border-surface-border focus:outline-none focus:ring-2 focus:ring-brand-500"
                style={{ color: "var(--text-primary)" }}
              >
                <option value="">— No category —</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Unit Cost"
              type="number"
              min="0"
              step="0.01"
              value={newItem.unit_cost}
              onChange={(e) => setNewItem((p) => ({ ...p, unit_cost: e.target.value }))}
            />
            <Input
              label="Reorder Level"
              type="number"
              min="0"
              step="0.01"
              value={newItem.reorder_level}
              onChange={(e) => setNewItem((p) => ({ ...p, reorder_level: e.target.value }))}
            />
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            A primary barcode is automatically generated from SKU after creation.
          </p>
        </div>
      </Modal>

      {/* Create Category Modal */}
      <Modal
        open={showAddCategoryModal}
        onClose={() => setShowAddCategoryModal(false)}
        title="Create Category"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowAddCategoryModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={createCategoryMutation.isPending}
              disabled={!newCategory.name.trim()}
              onClick={() => createCategoryMutation.mutate()}
            >
              Create Category
            </Button>
          </div>
        )}
      >
        <div className="p-5 space-y-3">
          <Input
            label="Category Name"
            placeholder="e.g. Chemicals, Electronics, Tools"
            value={newCategory.name}
            onChange={(e) => setNewCategory((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            label="Description (optional)"
            placeholder="Brief description of this category"
            value={newCategory.description}
            onChange={(e) => setNewCategory((p) => ({ ...p, description: e.target.value }))}
          />
        </div>
      </Modal>
    </div>
  );
}

function ItemRow({ item }: { item: ItemSummary }) {
  return (
    <tr className="hover:bg-surface-hover/50 transition-colors group">
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-brand-400">{item.sku}</span>
      </td>
      <td className="px-4 py-3">
        <p className="font-medium" style={{ color: "var(--text-primary)" }}>{item.name}</p>
      </td>
      <td className="px-4 py-3">
        {item.category_name && (
          <Badge variant="default" className="text-xs">{item.category_name}</Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={clsx(
          "font-semibold",
          item.status === "OUT" ? "text-red-400" : item.status === "LOW" ? "text-amber-400" : "text-emerald-400"
        )}>
          {item.total_quantity} {item.unit}
        </span>
      </td>
      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{item.reorder_level} {item.unit}</td>
      <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>${Number(item.unit_cost).toFixed(2)}</td>
      <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link
            to={`/inventory/${item.id}`}
            className="p-1.5 rounded-lg hover:bg-surface-hover" style={{ color: "var(--text-secondary)" }}
          >
            <QrCode size={14} />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function ItemCard({ item }: { item: ItemSummary }) {
  return (
    <Link to={`/inventory/${item.id}`}>
      <Card className="p-4 active:scale-[0.99] transition-transform">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-brand-400">{item.sku}</span>
              {item.category_name && (
                <Badge variant="default" className="text-xs">{item.category_name}</Badge>
              )}
            </div>
            <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.name}</p>
          </div>
          <StatusBadge status={item.status} />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>
            <span className={clsx(
              "font-semibold text-sm mr-0.5",
              item.status === "OUT" ? "text-red-400" : item.status === "LOW" ? "text-amber-400" : ""
            )}>
              {item.total_quantity}
            </span>
            {item.unit} on hand
          </span>
          <span>Reorder at {item.reorder_level}</span>
          <span>${Number(item.unit_cost).toFixed(2)}/unit</span>
        </div>
      </Card>
    </Link>
  );
}
