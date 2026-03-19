import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { clsx } from "clsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = ComponentType<any>;
import toast from "react-hot-toast";
import {
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Settings2,
  CheckCircle2, RotateCcw, Package, MapPin, QrCode,
  ChevronRight, Loader2, Plus, PenLine, Zap,
} from "lucide-react";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { scanApi } from "@/api/transactions";
import { itemsApi } from "@/api/items";
import type { ScanResult } from "@/types";
import { useQuery } from "@tanstack/react-query";

type ScanMode = "add" | "remove" | "transfer" | "modify";

// ─── Mode Selector ────────────────────────────────────────────────────────────

const MODES: Array<{
  id: ScanMode;
  label: string;
  icon: IconComponent;
  color: string;
  borderColor: string;
  bgColor: string;
  glowColor: string;
  desc: string;
}> = [
  {
    id: "add",
    label: "Add",
    icon: ArrowUpRight,
    color: "text-emerald-400",
    borderColor: "rgba(52,211,153,0.25)",
    bgColor: "rgba(52,211,153,0.06)",
    glowColor: "rgba(52,211,153,0.15)",
    desc: "Add stock to a rack",
  },
  {
    id: "remove",
    label: "Remove",
    icon: ArrowDownRight,
    color: "text-red-400",
    borderColor: "rgba(239,68,68,0.25)",
    bgColor: "rgba(239,68,68,0.06)",
    glowColor: "rgba(239,68,68,0.15)",
    desc: "Remove items from inventory",
  },
  {
    id: "transfer",
    label: "Transfer",
    icon: ArrowLeftRight,
    color: "text-brand-400",
    borderColor: "rgba(34,211,238,0.25)",
    bgColor: "rgba(34,211,238,0.06)",
    glowColor: "rgba(34,211,238,0.15)",
    desc: "Move between racks",
  },
  {
    id: "modify",
    label: "Modify",
    icon: Settings2,
    color: "text-purple-400",
    borderColor: "rgba(168,85,247,0.25)",
    bgColor: "rgba(168,85,247,0.06)",
    glowColor: "rgba(168,85,247,0.15)",
    desc: "Edit item details",
  },
];

function ModeSelector({ onSelect }: { onSelect: (m: ScanMode) => void }) {
  return (
    <div className="p-5 space-y-5">
      {/* Hero */}
      <div className="text-center space-y-2 py-2">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-2 animate-glow-pulse"
          style={{
            background: "rgba(34,211,238,0.1)",
            border: "1px solid rgba(34,211,238,0.3)",
          }}
        >
          <Zap size={26} className="text-brand-400" />
        </div>
        <h2 className="text-xl font-bold text-white">Scanner Workflow</h2>
        <p className="text-sm text-slate-500">Select an action to begin</p>
      </div>

      {/* Mode grid */}
      <div className="grid grid-cols-2 gap-3">
        {MODES.map(({ id, label, icon: Icon, color, borderColor, bgColor, glowColor, desc }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="group flex flex-col items-center gap-3 p-5 rounded-2xl text-center transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: bgColor,
              border: `1px solid ${borderColor}`,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 20px ${glowColor}`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
            }}
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center"
              style={{ background: `${glowColor}`, border: `1px solid ${borderColor}` }}
            >
              <Icon size={22} className={color} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────────────────

function ScannedCard({
  result,
  label,
  accent = "#22d3ee",
}: {
  result: ScanResult;
  label: string;
  accent?: string;
}) {
  return (
    <div
      className="flex items-center gap-3 p-3.5 rounded-xl"
      style={{
        background: `${accent}10`,
        border: `1px solid ${accent}30`,
      }}
    >
      <CheckCircle2 size={18} style={{ color: accent }} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: `${accent}20`, color: accent }}
          >
            {label}
          </span>
          <span className="text-xs text-slate-500 font-mono truncate">{result.code}</span>
        </div>
        <p className="text-sm text-slate-100 font-semibold mt-1 truncate">{result.name}</p>
        {result.result_type === "item" && typeof result.details?.total_quantity === "number" && (
          <p className="text-xs text-slate-500 mt-0.5">
            Stock: <span className="text-slate-300 font-medium">
              {result.details.total_quantity} {String(result.details.unit ?? "")}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * ScanPrompt — shows camera or manual entry.
 * Uses firedRef to guarantee onScan is called at most once per mount.
 * Resets when loading returns to false (allows retry on error).
 */
function ScanPrompt({
  label,
  hint,
  onScan,
  loading,
}: {
  label: string;
  hint?: string;
  onScan: (v: string) => void;
  loading: boolean;
}) {
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState("");

  // Prevent the scanner from calling onScan multiple times before unmount
  const firedRef = useRef(false);

  // Reset lock when parent signals it's done processing (error = allow retry)
  useEffect(() => {
    if (!loading) firedRef.current = false;
  }, [loading]);

  const handleScan = useCallback(
    (v: string) => {
      if (firedRef.current) return;
      firedRef.current = true;
      setCamera(false);
      onScan(v);
    },
    [onScan],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400 text-center">{label}</p>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 size={32} className="animate-spin text-brand-400" />
          <p className="text-xs text-slate-500">Processing…</p>
        </div>
      ) : camera ? (
        <BarcodeScanner
          onScan={handleScan}
          hint={hint ?? "Point at item QR code"}
          className="h-72 w-full rounded-2xl"
          autoStart
        />
      ) : (
        <button
          onClick={() => setCamera(true)}
          className="w-full flex flex-col items-center gap-3 py-8 rounded-2xl transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] animate-glow-pulse"
          style={{
            background: "rgba(34,211,238,0.04)",
            border: "1px solid rgba(34,211,238,0.2)",
            boxShadow: "0 0 30px rgba(34,211,238,0.05)",
          }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: "rgba(34,211,238,0.1)",
              border: "1px solid rgba(34,211,238,0.3)",
            }}
          >
            <QrCode size={28} className="text-brand-400" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-white">Open Camera</p>
            <p className="text-xs text-slate-500 mt-0.5">Tap to activate scanner</p>
          </div>
        </button>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
        <span className="text-xs text-slate-600 px-1">or type manually</span>
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = manual.trim();
          if (v && !firedRef.current) {
            firedRef.current = true;
            setManual("");
            onScan(v);
          }
        }}
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Enter barcode value…"
          className="flex-1"
        />
        <Button type="submit" variant="secondary">
          Go
        </Button>
      </form>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function FlowHeader({ icon: Icon, label, accent }: { icon: IconComponent; label: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accent}20`, border: `1px solid ${accent}30` }}
      >
        <Icon size={17} style={{ color: accent }} />
      </div>
      <h3 className="text-base font-semibold text-white">{label}</h3>
    </div>
  );
}

// ─── ADD WORKFLOW ─────────────────────────────────────────────────────────────

type AddSubMode =
  | "choose"
  | "scan-item"
  | "scan-rack"
  | "confirm"
  | "new-item"
  | "new-item-rack"
  | "new-item-confirm";

function AddFlow({ onReset }: { onReset: () => void }) {
  const [sub, setSub] = useState<AddSubMode>("choose");
  const [item, setItem] = useState<ScanResult | null>(null);
  const [rack, setRack] = useState<ScanResult | null>(null);
  const [qty, setQty] = useState("1");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const processingRef = useRef(false);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: itemsApi.getCategories,
  });

  const [newItem, setNewItem] = useState({
    sku: "",
    name: "",
    description: "",
    category_id: "",
    unit: "EA",
    unit_cost: "0",
    reorder_level: "0",
    supplier: "",
  });
  const [createdItem, setCreatedItem] = useState<{
    id: number;
    sku: string;
    name: string;
  } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrBlobUrl, setQrBlobUrl] = useState<string | null>(null);

  const doScan = useCallback(
    async (value: string, target: "item" | "rack") => {
      if (processingRef.current) return;
      processingRef.current = true;
      setLoading(true);
      try {
        const result = await scanApi.lookup(value);
        if (result.result_type === "unknown") {
          toast.error(`Unknown barcode: ${value}`);
          return;
        }
        if (target === "item" && result.result_type === "item") {
          setItem(result);
          setSub("scan-rack");
          toast.success(`Item loaded: ${result.name}`);
        } else if (target === "rack" && result.result_type === "location") {
          setRack(result);
          setSub(sub === "new-item-rack" ? "new-item-confirm" : "confirm");
          toast.success(`Rack: ${result.name}`);
        } else {
          toast.error(`Expected ${target === "item" ? "item QR" : "rack QR"} — try again`);
        }
      } catch {
        toast.error("Lookup failed. Try again.");
      } finally {
        setLoading(false);
        setTimeout(() => {
          processingRef.current = false;
        }, 500);
      }
    },
    [sub],
  );

  const commit = async () => {
    const targetItem =
      createdItem ?? (item ? { id: item.id!, name: item.name, sku: item.code } : null);
    if (!targetItem || !rack) return;
    setLoading(true);
    try {
      await scanApi.stockIn({
        item_id: targetItem.id,
        location_id: rack.id!,
        quantity: parseFloat(qty),
        reference: ref || undefined,
        notes: notes || undefined,
      });
      toast.success(`✓ Added ${qty} × ${targetItem.name} → ${rack.name}`);
      onReset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to add stock");
    } finally {
      setLoading(false);
    }
  };

  const createNewItem = async () => {
    if (!newItem.sku.trim() || !newItem.name.trim()) {
      toast.error("SKU and Name are required");
      return;
    }
    setLoading(true);
    try {
      const created = await itemsApi.create({
        sku: newItem.sku.trim().toUpperCase(),
        name: newItem.name.trim(),
        description: newItem.description || undefined,
        category_id: newItem.category_id ? Number(newItem.category_id) : undefined,
        unit: newItem.unit || "EA",
        unit_cost: parseFloat(newItem.unit_cost) || 0,
        reorder_level: parseFloat(newItem.reorder_level) || 0,
        supplier: newItem.supplier || undefined,
      });
      setCreatedItem({ id: created.id, sku: created.sku, name: created.name });
      toast.success(`Item ${created.sku} created!`);
      try {
        const blob = await itemsApi.downloadQrPng(created.id);
        setQrBlobUrl(URL.createObjectURL(blob));
        setShowQrModal(true);
      } catch {
        /* non-fatal */
      }
      setSub("new-item-rack");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to create item");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <FlowHeader icon={ArrowUpRight} label="Add Stock" accent="#34d399" />

      {/* QR Modal */}
      {showQrModal && qrBlobUrl && (
        <Modal open onClose={() => setShowQrModal(false)} title="Item QR Code — Print & Stick">
          <div className="p-6 flex flex-col items-center gap-4">
            <img
              src={qrBlobUrl}
              alt="QR Code"
              className="w-48 h-48 rounded-xl"
              style={{ border: "1px solid rgba(34,211,238,0.2)" }}
            />
            <p className="text-sm text-slate-400 text-center">
              Print this QR and stick it on the item for future scanning.
            </p>
            <div className="flex gap-2 w-full">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => window.open(qrBlobUrl, "_blank")}
              >
                Download
              </Button>
              <Button variant="primary" fullWidth onClick={() => setShowQrModal(false)}>
                Continue
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {sub === "choose" && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setSub("scan-item")}
            className="flex flex-col items-center gap-3 p-5 rounded-2xl transition-all hover:scale-[1.02]"
            style={{
              background: "rgba(52,211,153,0.06)",
              border: "1px solid rgba(52,211,153,0.25)",
            }}
          >
            <QrCode size={26} className="text-emerald-400" />
            <div className="text-center">
              <p className="text-sm font-semibold text-white">Scan QR</p>
              <p className="text-xs text-slate-500 mt-0.5">Item has a QR already</p>
            </div>
          </button>
          <button
            onClick={() => setSub("new-item")}
            className="flex flex-col items-center gap-3 p-5 rounded-2xl transition-all hover:scale-[1.02]"
            style={{
              background: "rgba(34,211,238,0.06)",
              border: "1px solid rgba(34,211,238,0.25)",
            }}
          >
            <Plus size={26} className="text-brand-400" />
            <div className="text-center">
              <p className="text-sm font-semibold text-white">New Item</p>
              <p className="text-xs text-slate-500 mt-0.5">Generate a new QR label</p>
            </div>
          </button>
        </div>
      )}

      {sub === "scan-item" && (
        <ScanPrompt
          label="Scan the item QR code"
          hint="Point at item QR code"
          onScan={(v) => doScan(v, "item")}
          loading={loading}
        />
      )}

      {sub === "scan-rack" && item && (
        <>
          <ScannedCard result={item} label="Item" accent="#34d399" />
          <ScanPrompt
            label="Now scan the destination rack QR"
            hint="Point at rack / location QR"
            onScan={(v) => doScan(v, "rack")}
            loading={loading}
          />
        </>
      )}

      {sub === "confirm" && item && rack && (
        <>
          <ScannedCard result={item} label="Item" accent="#34d399" />
          <ScannedCard result={rack} label="Rack" accent="#22d3ee" />
          <div className="space-y-3 pt-1">
            <Input
              label="Quantity"
              type="number"
              min="0.001"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <Input
              label="Reference / PO (optional)"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
            <Input
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button fullWidth size="lg" variant="success" loading={loading} onClick={commit}>
            Confirm Add Stock
          </Button>
        </>
      )}

      {sub === "new-item" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 text-center">
            Fill in details — a QR code will be generated automatically.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="SKU *"
              value={newItem.sku}
              onChange={(e) => setNewItem((p) => ({ ...p, sku: e.target.value }))}
              placeholder="SKU-011"
            />
            <Input
              label="Unit"
              value={newItem.unit}
              onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value }))}
              placeholder="EA"
            />
          </div>
          <Input
            label="Item Name *"
            value={newItem.name}
            onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
            placeholder="Sodium Chloride 500g"
          />
          <Input
            label="Description"
            value={newItem.description}
            onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))}
          />
          <label className="block text-sm text-slate-300">
            Category
            <select
              value={newItem.category_id}
              onChange={(e) => setNewItem((p) => ({ ...p, category_id: e.target.value }))}
              className="mt-1 w-full rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <option value="">Select category</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Unit Cost ($)"
              type="number"
              value={newItem.unit_cost}
              onChange={(e) => setNewItem((p) => ({ ...p, unit_cost: e.target.value }))}
            />
            <Input
              label="Reorder Level"
              type="number"
              value={newItem.reorder_level}
              onChange={(e) => setNewItem((p) => ({ ...p, reorder_level: e.target.value }))}
            />
          </div>
          <Input
            label="Supplier"
            value={newItem.supplier}
            onChange={(e) => setNewItem((p) => ({ ...p, supplier: e.target.value }))}
          />
          <Button
            fullWidth
            size="lg"
            variant="primary"
            loading={loading}
            disabled={!newItem.sku.trim() || !newItem.name.trim()}
            onClick={createNewItem}
          >
            Create Item & Generate QR
          </Button>
        </div>
      )}

      {sub === "new-item-rack" && createdItem && (
        <div className="space-y-3">
          <div
            className="p-4 rounded-xl"
            style={{
              background: "rgba(34,211,238,0.06)",
              border: "1px solid rgba(34,211,238,0.25)",
            }}
          >
            <p className="text-xs text-brand-400 font-semibold uppercase tracking-wide mb-1">
              Item Created
            </p>
            <p className="text-base text-white font-bold">{createdItem.name}</p>
            <p className="font-mono text-xs text-slate-400 mt-0.5">{createdItem.sku}</p>
          </div>
          <ScanPrompt
            label="Scan the destination rack QR"
            hint="Point at rack / location QR"
            onScan={(v) => doScan(v, "rack")}
            loading={loading}
          />
          <Button variant="secondary" fullWidth onClick={onReset}>
            Skip — Add to Inventory Later
          </Button>
        </div>
      )}

      {sub === "new-item-confirm" && createdItem && rack && (
        <>
          <div
            className="p-4 rounded-xl"
            style={{
              background: "rgba(34,211,238,0.06)",
              border: "1px solid rgba(34,211,238,0.25)",
            }}
          >
            <p className="text-xs text-brand-400 font-semibold">New Item</p>
            <p className="text-base font-bold text-white mt-0.5">{createdItem.name}</p>
            <p className="font-mono text-xs text-slate-400">{createdItem.sku}</p>
          </div>
          <ScannedCard result={rack} label="Rack" accent="#22d3ee" />
          <div className="space-y-3">
            <Input
              label="Initial Quantity"
              type="number"
              min="0.001"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <Input
              label="Reference / PO (optional)"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
          <Button fullWidth size="lg" variant="success" loading={loading} onClick={commit}>
            Add Initial Stock
          </Button>
        </>
      )}
    </div>
  );
}

// ─── REMOVE WORKFLOW ──────────────────────────────────────────────────────────

type RemoveStep = "scan-item" | "scan-rack" | "confirm";

function RemoveFlow({ onReset }: { onReset: () => void }) {
  const [step, setStep] = useState<RemoveStep>("scan-item");
  const [item, setItem] = useState<ScanResult | null>(null);
  const [rack, setRack] = useState<ScanResult | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [borrower, setBorrower] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const processingRef = useRef(false);

  const doScan = useCallback(async (value: string, target: "item" | "rack") => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type === "unknown") {
        toast.error(`Unknown barcode: ${value}`);
        return;
      }
      if (target === "item" && result.result_type === "item") {
        setItem(result);
        setStep("scan-rack");
        toast.success(`Item loaded: ${result.name}`);
      } else if (target === "rack" && result.result_type === "location") {
        setRack(result);
        setStep("confirm");
        toast.success(`Rack scanned: ${result.name}`);
      } else {
        toast.error(`Expected ${target === "item" ? "item QR" : "rack QR"} — try again`);
      }
    } catch {
      toast.error("Lookup failed. Try again.");
    } finally {
      setLoading(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 500);
    }
  }, []);

  const commit = async () => {
    if (!item || !rack) return;
    setLoading(true);
    try {
      await scanApi.stockOut({
        item_id: item.id!,
        location_id: rack.id!,
        quantity: parseFloat(qty),
        reason: reason || undefined,
        borrower: borrower || undefined,
        notes: notes || undefined,
      });
      toast.success(`✓ Removed ${qty} × ${item.name} from ${rack.name}`);
      onReset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to remove stock");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <FlowHeader icon={ArrowDownRight} label="Remove Stock" accent="#f87171" />

      {step === "scan-item" && (
        <ScanPrompt
          label="Scan item QR code to remove"
          hint="Point at item QR code"
          onScan={(v) => doScan(v, "item")}
          loading={loading}
        />
      )}

      {step === "scan-rack" && item && (
        <>
          <ScannedCard result={item} label="Item" accent="#34d399" />
          <ScanPrompt
            label="Scan the rack you are taking it from"
            hint="Point at rack / location QR"
            onScan={(v) => doScan(v, "rack")}
            loading={loading}
          />
        </>
      )}

      {step === "confirm" && item && rack && (
        <div className="space-y-4">
          <ScannedCard result={item} label="Item" accent="#34d399" />
          <ScannedCard result={rack} label="Source Rack" accent="#f87171" />

          {/* Stock info banner */}
          <div
            className="flex items-center justify-between p-3.5 rounded-xl"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <div>
              <p className="text-xs text-red-400 font-medium">Available Stock</p>
              <p className="text-xl font-bold text-white">
                {item.details?.total_quantity ?? "?"}{" "}
                <span className="text-sm font-normal text-slate-400">
                  {item.details?.unit ?? ""}
                </span>
              </p>
            </div>
            <Package size={24} className="text-red-400/50" />
          </div>

          <div className="space-y-3">
            <Input
              label="Quantity to Remove"
              type="number"
              min="0.001"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <Input
              label="Reason / Purpose (optional)"
              placeholder="Experiment A1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Input
              label="Borrower (optional)"
              placeholder="Dr. Smith"
              value={borrower}
              onChange={(e) => setBorrower(e.target.value)}
            />
            <Input
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button fullWidth size="lg" variant="danger" loading={loading} onClick={commit}>
            Confirm Remove
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── TRANSFER WORKFLOW ────────────────────────────────────────────────────────

type TransferStep = "scan-item" | "item-loaded" | "scan-source-rack" | "scan-dest-rack" | "confirm";

function TransferFlow({ onReset }: { onReset: () => void }) {
  const [step, setStep] = useState<TransferStep>("scan-item");
  const [item, setItem] = useState<ScanResult | null>(null);
  const [sourceRack, setSourceRack] = useState<ScanResult | null>(null);
  const [destRack, setDestRack] = useState<ScanResult | null>(null);
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const processingRef = useRef(false);

  const doScan = useCallback(
    async (value: string, target: "item" | "source" | "dest") => {
      if (processingRef.current) return;
      processingRef.current = true;
      setLoading(true);
      try {
        const result = await scanApi.lookup(value);
        if (result.result_type === "unknown") {
          toast.error(`Unknown barcode: ${value}`);
          return;
        }
        if (target === "item" && result.result_type === "item") {
          setItem(result);
          setStep("item-loaded");
          toast.success(`Item loaded: ${result.name}`);
        } else if (target === "source" && result.result_type === "location") {
          setSourceRack(result);
          setStep("scan-dest-rack");
          toast.success(`Source rack: ${result.name}`);
        } else if (target === "dest" && result.result_type === "location") {
          setDestRack(result);
          setStep("confirm");
          toast.success(`Destination rack: ${result.name}`);
        } else {
          toast.error(`Expected ${target === "item" ? "item QR" : "rack QR"} — try again`);
        }
      } catch {
        toast.error("Lookup failed. Try again.");
      } finally {
        setLoading(false);
        setTimeout(() => {
          processingRef.current = false;
        }, 500);
      }
    },
    [],
  );

  const commit = async () => {
    if (!item || !sourceRack || !destRack) return;
    setLoading(true);
    try {
      await scanApi.transfer({
        item_id: item.id!,
        from_location_id: sourceRack.id!,
        to_location_id: destRack.id!,
        quantity: parseFloat(qty),
        notes: notes || undefined,
      });
      toast.success(`✓ Transferred ${qty} × ${item.name}: ${sourceRack.code} → ${destRack.code}`);
      onReset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Transfer failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <FlowHeader icon={ArrowLeftRight} label="Transfer Between Racks" accent="#22d3ee" />

      {step === "scan-item" && (
        <ScanPrompt
          label="Scan the item QR to transfer"
          hint="Point at item QR code"
          onScan={(v) => doScan(v, "item")}
          loading={loading}
        />
      )}

      {/* Show full item info after scan, then prompt for source rack */}
      {step === "item-loaded" && item && (
        <div className="space-y-4">
          <ScannedCard result={item} label="Item Loaded" accent="#22d3ee" />

          {/* Detailed item info */}
          <div
            className="p-4 rounded-xl space-y-2"
            style={{
              background: "rgba(34,211,238,0.05)",
              border: "1px solid rgba(34,211,238,0.15)",
            }}
          >
            <p className="text-xs text-brand-400 font-semibold uppercase tracking-wide">
              Item Details
            </p>
            <p className="text-lg font-bold text-white">{item.name}</p>
            <p className="font-mono text-xs text-slate-400">{item.code}</p>
            {typeof item.details?.total_quantity === "number" && (
              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-2xl font-bold text-brand-400">
                  {item.details.total_quantity}
                </span>
                <span className="text-sm text-slate-400">{item.details?.unit ?? "units"} in stock</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setStep("scan-source-rack")}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(34,211,238,0.2), rgba(8,145,178,0.2))",
              border: "1px solid rgba(34,211,238,0.35)",
            }}
          >
            <MapPin size={16} />
            Proceed — Scan Source Rack
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {step === "scan-source-rack" && item && (
        <>
          <ScannedCard result={item} label="Item" accent="#22d3ee" />
          <ScanPrompt
            label="Scan the SOURCE rack (where item currently is)"
            hint="Point at rack / location QR"
            onScan={(v) => doScan(v, "source")}
            loading={loading}
          />
        </>
      )}

      {step === "scan-dest-rack" && item && sourceRack && (
        <>
          <ScannedCard result={item} label="Item" accent="#22d3ee" />
          <ScannedCard result={sourceRack} label="Source Rack" accent="#f87171" />
          <ScanPrompt
            label="Scan the DESTINATION rack (where to place it)"
            hint="Point at rack / location QR"
            onScan={(v) => doScan(v, "dest")}
            loading={loading}
          />
        </>
      )}

      {step === "confirm" && item && sourceRack && destRack && (
        <div className="space-y-4">
          <ScannedCard result={item} label="Item" accent="#22d3ee" />

          {/* Transfer route visualiser */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ScannedCard result={sourceRack} label="From" accent="#f87171" />
            </div>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)" }}
            >
              <ArrowLeftRight size={14} className="text-brand-400" />
            </div>
            <div className="flex-1">
              <ScannedCard result={destRack} label="To" accent="#22d3ee" />
            </div>
          </div>

          <div
            className="flex items-baseline justify-between p-3.5 rounded-xl"
            style={{
              background: "rgba(34,211,238,0.06)",
              border: "1px solid rgba(34,211,238,0.2)",
            }}
          >
            <span className="text-sm text-slate-400">Available</span>
            <span className="text-lg font-bold text-white">
              {item.details?.total_quantity ?? "?"}{" "}
              <span className="text-sm font-normal text-slate-400">{item.details?.unit ?? ""}</span>
            </span>
          </div>

          <div className="space-y-3">
            <Input
              label="Quantity to Transfer"
              type="number"
              min="0.001"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <Input
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button fullWidth size="lg" variant="primary" loading={loading} onClick={commit}>
            Confirm Transfer
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── MODIFY WORKFLOW ──────────────────────────────────────────────────────────

type ModifyStep = "scan-item" | "edit-form";

function ModifyFlow({ onReset }: { onReset: () => void }) {
  const [step, setStep] = useState<ModifyStep>("scan-item");
  const [scannedItem, setScannedItem] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const processingRef = useRef(false);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: itemsApi.getCategories,
  });

  const [form, setForm] = useState({
    name: "",
    description: "",
    category_id: "",
    unit: "",
    unit_cost: "",
    reorder_level: "",
    supplier: "",
    notes: "",
  });

  const doScan = useCallback(async (value: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type !== "item") {
        toast.error("Scan an item QR — this is a rack barcode");
        return;
      }
      setScannedItem(result);
      const full = await itemsApi.get(result.id!);
      setForm({
        name: full.name ?? "",
        description: full.description ?? "",
        category_id: full.category ? String(full.category.id) : "",
        unit: full.unit ?? "EA",
        unit_cost: String(full.unit_cost ?? 0),
        reorder_level: String(full.reorder_level ?? 0),
        supplier: full.supplier ?? "",
        notes: (full as unknown as { notes?: string }).notes ?? "",
      });
      setStep("edit-form");
      toast.success(`Loaded: ${result.name}`);
    } catch {
      toast.error("Lookup failed. Try again.");
    } finally {
      setLoading(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 500);
    }
  }, []);

  const save = async () => {
    if (!scannedItem) return;
    setSaving(true);
    try {
      await scanApi.modifyItem({
        item_id: scannedItem.id!,
        name: form.name || undefined,
        description: form.description || undefined,
        category_id: form.category_id ? Number(form.category_id) : undefined,
        unit: form.unit || undefined,
        unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : undefined,
        reorder_level: form.reorder_level ? parseFloat(form.reorder_level) : undefined,
        supplier: form.supplier || undefined,
        notes: form.notes || undefined,
      });
      toast.success("Item updated successfully!");
      onReset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to update item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <FlowHeader icon={Settings2} label="Modify Item" accent="#c084fc" />

      {step === "scan-item" && (
        <ScanPrompt
          label="Scan item QR to load its details"
          hint="Point at item QR code"
          onScan={doScan}
          loading={loading}
        />
      )}

      {step === "edit-form" && scannedItem && (
        <div className="space-y-3">
          {/* Editing badge */}
          <div
            className="flex items-center gap-3 p-4 rounded-xl"
            style={{
              background: "rgba(168,85,247,0.06)",
              border: "1px solid rgba(168,85,247,0.25)",
            }}
          >
            <PenLine size={18} className="text-purple-400 shrink-0" />
            <div>
              <p className="text-xs text-purple-400 font-semibold uppercase tracking-wide">
                Editing
              </p>
              <p className="text-base font-bold text-white">{scannedItem.name}</p>
              <p className="font-mono text-xs text-slate-400">{scannedItem.code}</p>
            </div>
          </div>

          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />

          <label className="block text-sm text-slate-300">
            Category
            <select
              value={form.category_id}
              onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}
              className="mt-1 w-full rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <option value="">No category</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Unit"
              value={form.unit}
              onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
            />
            <Input
              label="Unit Cost ($)"
              type="number"
              value={form.unit_cost}
              onChange={(e) => setForm((p) => ({ ...p, unit_cost: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Reorder Level"
              type="number"
              value={form.reorder_level}
              onChange={(e) => setForm((p) => ({ ...p, reorder_level: e.target.value }))}
            />
            <Input
              label="Supplier"
              value={form.supplier}
              onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
            />
          </div>
          <Input
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />

          <Button
            fullWidth
            size="lg"
            loading={saving}
            onClick={save}
            className="bg-purple-600 hover:bg-purple-500 text-white"
          >
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Root Scan Page ───────────────────────────────────────────────────────────

const MODE_META: Record<
  ScanMode,
  { icon: IconComponent; label: string; accent: string; badgeVariant: "success" | "danger" | "info" | "default" }
> = {
  add:      { icon: ArrowUpRight,   label: "Add",      accent: "#34d399", badgeVariant: "success" },
  remove:   { icon: ArrowDownRight, label: "Remove",   accent: "#f87171", badgeVariant: "danger" },
  transfer: { icon: ArrowLeftRight, label: "Transfer", accent: "#22d3ee", badgeVariant: "info" },
  modify:   { icon: Settings2,      label: "Modify",   accent: "#c084fc", badgeVariant: "default" },
};

export function Scan() {
  const [mode, setMode] = useState<ScanMode | null>(null);

  const meta = mode ? MODE_META[mode] : null;
  const Icon = meta?.icon ?? null;

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto">
      {/* Header */}
      <div
        className="px-5 py-3.5 flex items-center gap-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {mode ? (
          <button
            onClick={() => setMode(null)}
            className="text-slate-500 hover:text-brand-400 transition-colors"
          >
            <RotateCcw size={17} />
          </button>
        ) : (
          <Package size={18} className="text-slate-500" />
        )}

        {Icon && meta && (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${meta.accent}20`, border: `1px solid ${meta.accent}30` }}
          >
            <Icon size={14} style={{ color: meta.accent }} />
          </div>
        )}

        <h2 className="text-base font-bold text-white flex-1">
          {meta ? `${meta.label} — Scanner` : "Scanner Workflow"}
        </h2>

        {meta && (
          <Badge variant={meta.badgeVariant} className="text-xs capitalize">
            {mode}
          </Badge>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {!mode && <ModeSelector onSelect={setMode} />}
        {mode === "add"      && <AddFlow      onReset={() => setMode(null)} />}
        {mode === "remove"   && <RemoveFlow   onReset={() => setMode(null)} />}
        {mode === "transfer" && <TransferFlow onReset={() => setMode(null)} />}
        {mode === "modify"   && <ModifyFlow   onReset={() => setMode(null)} />}
      </div>
    </div>
  );
}
