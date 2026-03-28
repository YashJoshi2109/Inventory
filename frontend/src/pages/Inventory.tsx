import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { itemsApi } from "@/api/items";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  Search, Plus, QrCode,
  ChevronLeft, ChevronRight, Package,
} from "lucide-react";
import { clsx } from "clsx";
import type { ItemSummary } from "@/types";
import { useHaptic } from "@/hooks/useHaptic";

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "In Stock", value: "OK" },
  { label: "Low Stock", value: "LOW" },
  { label: "Out of Stock", value: "OUT" },
];

export function Inventory() {
  const { triggerHaptic } = useHaptic();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItem, setNewItem] = useState({
    sku: "",
    name: "",
    category_id: "",
    unit: "pcs",
    unit_cost: "0",
    reorder_level: "0",
  });
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
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface-card border border-surface-border rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <Button variant="primary" leftIcon={<Plus size={15} />} size="md" onClick={() => setShowAddModal(true)}>
          Add Item
        </Button>
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
                : "bg-surface-card border border-surface-border text-slate-400 hover:text-white"
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
            className="px-3 py-1.5 rounded-lg text-sm bg-surface-card border border-surface-border text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>{data.total.toLocaleString()} items</span>
          <span>Page {data.page} of {data.total_pages}</span>
        </div>
      )}

      {/* Table / list */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
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
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">
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
              <span className="text-sm text-slate-400">
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
            <Input
              label="Category ID (optional)"
              type="number"
              value={newItem.category_id}
              onChange={(e) => setNewItem((p) => ({ ...p, category_id: e.target.value }))}
            />
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
          <p className="text-xs text-slate-500">
            A primary barcode is automatically generated from SKU after creation.
          </p>
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
        <p className="text-slate-200 font-medium">{item.name}</p>
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
      <td className="px-4 py-3 text-slate-400">{item.reorder_level} {item.unit}</td>
      <td className="px-4 py-3 text-slate-300">${Number(item.unit_cost).toFixed(2)}</td>
      <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link
            to={`/inventory/${item.id}`}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white"
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
            <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
          </div>
          <StatusBadge status={item.status} />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
          <span>
            <span className={clsx(
              "font-semibold text-sm mr-0.5",
              item.status === "OUT" ? "text-red-400" : item.status === "LOW" ? "text-amber-400" : "text-slate-200"
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
