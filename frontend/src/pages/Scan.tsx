import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import {
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Settings2,
  CheckCircle2, RotateCcw, Package, MapPin, QrCode,
  ChevronRight, Loader2, Plus, PenLine,
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

const MODES: Array<{ id: ScanMode; label: string; icon: React.ElementType; color: string; desc: string }> = [
  { id: "add",      label: "Add",      icon: ArrowUpRight,   color: "emerald", desc: "Add stock to inventory" },
  { id: "remove",   label: "Remove",   icon: ArrowDownRight, color: "red",     desc: "Remove items from a rack" },
  { id: "transfer", label: "Transfer", icon: ArrowLeftRight, color: "blue",    desc: "Move items between racks" },
  { id: "modify",   label: "Modify",   icon: Settings2,      color: "purple",  desc: "Edit item details" },
];

function ModeSelector({ onSelect }: { onSelect: (m: ScanMode) => void }) {
  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Choose action</p>
      {MODES.map(({ id, label, icon: Icon, color, desc }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={clsx(
            "w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left",
            `border-${color}-500/30 bg-${color}-500/5 hover:bg-${color}-500/15`,
          )}
        >
          <div className={clsx("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", `bg-${color}-500/20`)}>
            <Icon size={20} className={`text-${color}-400`} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-100">{label}</p>
            <p className="text-xs text-slate-500">{desc}</p>
          </div>
          <ChevronRight size={16} className="text-slate-500 shrink-0" />
        </button>
      ))}
    </div>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────────────────

function ScannedCard({ result, label, color = "emerald" }: { result: ScanResult; label: string; color?: string }) {
  return (
    <div className={clsx(
      "flex items-center gap-3 p-3 rounded-xl border",
      `bg-${color}-500/10 border-${color}-500/30`
    )}>
      <CheckCircle2 size={18} className={`text-${color}-400 shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="success" className="text-xs">{label}</Badge>
          <span className="text-xs text-slate-400 font-mono">{result.code}</span>
        </div>
        <p className="text-sm text-slate-200 font-medium mt-0.5 truncate">{result.name}</p>
        {result.result_type === "item" && typeof result.details?.total_quantity === "number" && (
          <p className="text-xs text-slate-500">
            Stock: {result.details.total_quantity} {String(result.details.unit ?? "")}
          </p>
        )}
      </div>
    </div>
  );
}

function ScanPrompt({
  label,
  onScan,
  loading,
}: {
  label: string;
  onScan: (v: string) => void;
  loading: boolean;
}) {
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400 text-center">{label}</p>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={28} className="animate-spin text-brand-400" />
        </div>
      ) : camera ? (
        <BarcodeScanner
          onScan={(v) => { setCamera(false); onScan(v); }}
          className="h-52 w-full rounded-xl"
          autoStart
        />
      ) : (
        <Button fullWidth size="lg" leftIcon={<QrCode size={18} />} onClick={() => setCamera(true)}>
          Open Camera
        </Button>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-surface-border" />
        <span className="text-xs text-slate-500">or type manually</span>
        <div className="flex-1 h-px bg-surface-border" />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); const v = manual.trim(); if (v) { setManual(""); onScan(v); } }}
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Enter barcode value…"
          className="flex-1"
        />
        <Button type="submit" variant="secondary">Go</Button>
      </form>
    </div>
  );
}

// ─── ADD WORKFLOW ─────────────────────────────────────────────────────────────

type AddSubMode = "choose" | "scan-item" | "scan-rack" | "confirm" | "new-item" | "new-item-rack" | "new-item-confirm";

function AddFlow({ onReset }: { onReset: () => void }) {
  const [sub, setSub] = useState<AddSubMode>("choose");
  const [item, setItem] = useState<ScanResult | null>(null);
  const [rack, setRack] = useState<ScanResult | null>(null);
  const [qty, setQty] = useState("1");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const processingRef = useRef(false);

  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: itemsApi.getCategories });

  const [newItem, setNewItem] = useState({
    sku: "", name: "", description: "", category_id: "", unit: "EA",
    unit_cost: "0", reorder_level: "0", supplier: "",
  });
  const [createdItem, setCreatedItem] = useState<{ id: number; sku: string; name: string } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrBlobUrl, setQrBlobUrl] = useState<string | null>(null);

  const doScan = useCallback(async (value: string, target: "item" | "rack") => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type === "unknown") { toast.error(`Unknown barcode: ${value}`); return; }
      if (target === "item" && result.result_type === "item") {
        setItem(result); setSub("scan-rack");
        toast.success(`Item: ${result.name}`);
      } else if (target === "rack" && result.result_type === "location") {
        setRack(result); setSub(sub === "new-item-rack" ? "new-item-confirm" : "confirm");
        toast.success(`Rack: ${result.name}`);
      } else {
        toast.error(`Expected ${target === "item" ? "item" : "rack"} barcode`);
      }
    } catch { toast.error("Lookup failed. Try again."); }
    finally { setLoading(false); setTimeout(() => { processingRef.current = false; }, 500); }
  }, [sub]);

  const commit = async () => {
    const targetItem = createdItem ?? (item ? { id: item.id!, name: item.name, sku: item.code } : null);
    if (!targetItem || !rack) return;
    setLoading(true);
    try {
      await scanApi.stockIn({ item_id: targetItem.id, location_id: rack.id!, quantity: parseFloat(qty), reference: ref || undefined, notes: notes || undefined });
      toast.success(`Added ${qty} × ${targetItem.name} → ${rack.name}`);
      onReset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to add stock");
    } finally { setLoading(false); }
  };

  const createNewItem = async () => {
    if (!newItem.sku.trim() || !newItem.name.trim()) { toast.error("SKU and Name are required"); return; }
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
      // Load QR blob
      try {
        const blob = await itemsApi.downloadQrPng(created.id);
        setQrBlobUrl(URL.createObjectURL(blob));
        setShowQrModal(true);
      } catch { /* non-fatal */ }
      setSub("new-item-rack");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to create item");
    } finally { setLoading(false); }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <ArrowUpRight size={16} className="text-emerald-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">Add Stock</h3>
      </div>

      {/* QR Modal */}
      {showQrModal && qrBlobUrl && (
        <Modal open onClose={() => setShowQrModal(false)} title="Item QR Code — Print & Stick">
          <div className="p-6 flex flex-col items-center gap-4">
            <img src={qrBlobUrl} alt="QR Code" className="w-48 h-48 border border-surface-border rounded-lg" />
            <p className="text-sm text-slate-400 text-center">Print this QR and stick it on the item for future scanning.</p>
            <div className="flex gap-2 w-full">
              <Button variant="secondary" fullWidth onClick={() => window.open(qrBlobUrl, "_blank")}>Download</Button>
              <Button variant="primary" fullWidth onClick={() => setShowQrModal(false)}>Continue</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Sub-mode chooser */}
      {sub === "choose" && (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setSub("scan-item")} className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 flex flex-col items-center gap-2 transition-all">
            <QrCode size={24} className="text-emerald-400" />
            <span className="text-sm font-medium text-slate-200">Scan Existing QR</span>
            <span className="text-xs text-slate-500 text-center">Item already has a QR</span>
          </button>
          <button onClick={() => setSub("new-item")} className="p-4 rounded-xl border border-brand-500/30 bg-brand-500/5 hover:bg-brand-500/15 flex flex-col items-center gap-2 transition-all">
            <Plus size={24} className="text-brand-400" />
            <span className="text-sm font-medium text-slate-200">New Item</span>
            <span className="text-xs text-slate-500 text-center">Generate a new QR label</span>
          </button>
        </div>
      )}

      {/* Scan existing item */}
      {sub === "scan-item" && (
        <ScanPrompt label="Scan the item QR code" onScan={(v) => doScan(v, "item")} loading={loading} />
      )}

      {/* Scan rack after scanning existing item */}
      {sub === "scan-rack" && item && (
        <>
          <ScannedCard result={item} label="Item" />
          <ScanPrompt label="Scan the destination rack QR" onScan={(v) => doScan(v, "rack")} loading={loading} />
        </>
      )}

      {/* Confirm stock-in */}
      {sub === "confirm" && item && rack && (
        <>
          <ScannedCard result={item} label="Item" />
          <ScannedCard result={rack} label="Rack" color="blue" />
          <Input label="Quantity" type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input label="Reference / PO (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button fullWidth size="lg" variant="success" loading={loading} onClick={commit}>
            Confirm Add Stock
          </Button>
        </>
      )}

      {/* New item form */}
      {sub === "new-item" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Fill in details — a QR code will be generated automatically.</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="SKU *" value={newItem.sku} onChange={(e) => setNewItem(p => ({ ...p, sku: e.target.value }))} placeholder="SKU-011" />
            <Input label="Unit" value={newItem.unit} onChange={(e) => setNewItem(p => ({ ...p, unit: e.target.value }))} placeholder="EA" />
          </div>
          <Input label="Item Name *" value={newItem.name} onChange={(e) => setNewItem(p => ({ ...p, name: e.target.value }))} placeholder="Sodium Chloride 500g" />
          <Input label="Description" value={newItem.description} onChange={(e) => setNewItem(p => ({ ...p, description: e.target.value }))} />
          <label className="block text-sm text-slate-300">
            Category
            <select
              value={newItem.category_id}
              onChange={(e) => setNewItem(p => ({ ...p, category_id: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select category</option>
              {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Unit Cost ($)" type="number" value={newItem.unit_cost} onChange={(e) => setNewItem(p => ({ ...p, unit_cost: e.target.value }))} />
            <Input label="Reorder Level" type="number" value={newItem.reorder_level} onChange={(e) => setNewItem(p => ({ ...p, reorder_level: e.target.value }))} />
          </div>
          <Input label="Supplier" value={newItem.supplier} onChange={(e) => setNewItem(p => ({ ...p, supplier: e.target.value }))} />
          <Button fullWidth size="lg" variant="primary" loading={loading}
            disabled={!newItem.sku.trim() || !newItem.name.trim()}
            onClick={createNewItem}
          >
            Create Item & Generate QR
          </Button>
        </div>
      )}

      {/* New item: scan rack */}
      {sub === "new-item-rack" && createdItem && (
        <div className="space-y-3">
          <div className="p-3 bg-brand-500/10 border border-brand-500/30 rounded-xl">
            <p className="text-xs text-brand-400 font-medium">New item created</p>
            <p className="text-sm text-slate-200 font-semibold">{createdItem.name}</p>
            <p className="font-mono text-xs text-slate-400">{createdItem.sku}</p>
          </div>
          <ScanPrompt label="Scan the destination rack QR" onScan={(v) => doScan(v, "rack")} loading={loading} />
          <Button variant="secondary" fullWidth onClick={onReset}>Skip — Add to Inventory Later</Button>
        </div>
      )}

      {/* New item: confirm */}
      {sub === "new-item-confirm" && createdItem && rack && (
        <>
          <div className="p-3 bg-brand-500/10 border border-brand-500/30 rounded-xl">
            <p className="text-xs text-brand-400 font-medium">New Item</p>
            <p className="text-sm font-semibold text-slate-200">{createdItem.name} <span className="font-mono text-xs text-slate-400">{createdItem.sku}</span></p>
          </div>
          <ScannedCard result={rack} label="Rack" color="blue" />
          <Input label="Initial Quantity" type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input label="Reference / PO (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
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
      if (result.result_type === "unknown") { toast.error(`Unknown barcode: ${value}`); return; }
      if (target === "item" && result.result_type === "item") {
        setItem(result); setStep("scan-rack");
        toast.success(`Item: ${result.name}`);
      } else if (target === "rack" && result.result_type === "location") {
        setRack(result); setStep("confirm");
        toast.success(`Rack: ${result.name}`);
      } else {
        toast.error(`Expected ${target === "item" ? "item QR" : "rack QR"}`);
      }
    } catch { toast.error("Lookup failed. Try again."); }
    finally { setLoading(false); setTimeout(() => { processingRef.current = false; }, 500); }
  }, []);

  const commit = async () => {
    if (!item || !rack) return;
    setLoading(true);
    try {
      await scanApi.stockOut({
        item_id: item.id!, location_id: rack.id!,
        quantity: parseFloat(qty),
        reason: reason || undefined,
        borrower: borrower || undefined,
        notes: notes || undefined,
      });
      toast.success(`Removed ${qty} × ${item.name} from ${rack.name}`);
      onReset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to remove stock");
    } finally { setLoading(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
          <ArrowDownRight size={16} className="text-red-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">Remove Stock</h3>
      </div>

      {step === "scan-item" && (
        <ScanPrompt label="Scan the item QR code to remove" onScan={(v) => doScan(v, "item")} loading={loading} />
      )}

      {step === "scan-rack" && item && (
        <>
          <ScannedCard result={item} label="Item" />
          <p className="text-xs text-slate-500 text-center">Scan the rack QR you are taking it from</p>
          <ScanPrompt label="Scan source rack QR" onScan={(v) => doScan(v, "rack")} loading={loading} />
        </>
      )}

      {step === "confirm" && item && rack && (
        <>
          <ScannedCard result={item} label="Item" />
          <ScannedCard result={rack} label="From Rack" color="red" />
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-slate-300">
            Current stock: <span className="font-semibold text-white">{item.details?.total_quantity ?? "?"} {item.details?.unit ?? ""}</span>
          </div>
          <Input label="Quantity to Remove" type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input label="Reason / Purpose (optional)" placeholder="Experiment A1" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input label="Borrower (optional)" placeholder="Dr. Smith" value={borrower} onChange={(e) => setBorrower(e.target.value)} />
          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button fullWidth size="lg" variant="danger" loading={loading} onClick={commit}>
            Confirm Remove
          </Button>
        </>
      )}
    </div>
  );
}

// ─── TRANSFER WORKFLOW ────────────────────────────────────────────────────────

type TransferStep = "scan-item" | "scan-source-rack" | "scan-dest-rack" | "confirm";

function TransferFlow({ onReset }: { onReset: () => void }) {
  const [step, setStep] = useState<TransferStep>("scan-item");
  const [item, setItem] = useState<ScanResult | null>(null);
  const [sourceRack, setSourceRack] = useState<ScanResult | null>(null);
  const [destRack, setDestRack] = useState<ScanResult | null>(null);
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const processingRef = useRef(false);

  const doScan = useCallback(async (value: string, target: "item" | "source" | "dest") => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type === "unknown") { toast.error(`Unknown barcode: ${value}`); return; }
      if (target === "item" && result.result_type === "item") {
        setItem(result); setStep("scan-source-rack");
        toast.success(`Item: ${result.name}`);
      } else if (target === "source" && result.result_type === "location") {
        setSourceRack(result); setStep("scan-dest-rack");
        toast.success(`Source rack: ${result.name}`);
      } else if (target === "dest" && result.result_type === "location") {
        setDestRack(result); setStep("confirm");
        toast.success(`Destination rack: ${result.name}`);
      } else {
        toast.error(`Expected ${target === "item" ? "item QR" : "rack QR"}`);
      }
    } catch { toast.error("Lookup failed. Try again."); }
    finally { setLoading(false); setTimeout(() => { processingRef.current = false; }, 500); }
  }, []);

  const commit = async () => {
    if (!item || !sourceRack || !destRack) return;
    setLoading(true);
    try {
      await scanApi.transfer({
        item_id: item.id!, from_location_id: sourceRack.id!, to_location_id: destRack.id!,
        quantity: parseFloat(qty), notes: notes || undefined,
      });
      toast.success(`Transferred ${qty} × ${item.name}: ${sourceRack.code} → ${destRack.code}`);
      onReset();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Transfer failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <ArrowLeftRight size={16} className="text-blue-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">Transfer Between Racks</h3>
      </div>

      {step === "scan-item" && (
        <ScanPrompt label="Scan the item QR to transfer" onScan={(v) => doScan(v, "item")} loading={loading} />
      )}
      {step === "scan-source-rack" && item && (
        <>
          <ScannedCard result={item} label="Item" />
          <ScanPrompt label="Scan the SOURCE rack (where item currently is)" onScan={(v) => doScan(v, "source")} loading={loading} />
        </>
      )}
      {step === "scan-dest-rack" && item && sourceRack && (
        <>
          <ScannedCard result={item} label="Item" />
          <ScannedCard result={sourceRack} label="Source Rack" color="red" />
          <ScanPrompt label="Scan the DESTINATION rack (where to move it)" onScan={(v) => doScan(v, "dest")} loading={loading} />
        </>
      )}
      {step === "confirm" && item && sourceRack && destRack && (
        <>
          <ScannedCard result={item} label="Item" />
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ScannedCard result={sourceRack} label="From" color="red" />
            </div>
            <ArrowLeftRight size={16} className="text-slate-400 shrink-0" />
            <div className="flex-1">
              <ScannedCard result={destRack} label="To" color="blue" />
            </div>
          </div>
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-slate-300">
            Available stock: <span className="font-semibold text-white">{item.details?.total_quantity ?? "?"} {item.details?.unit ?? ""}</span>
          </div>
          <Input label="Quantity to Transfer" type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button fullWidth size="lg" variant="primary" loading={loading} onClick={commit}>
            Confirm Transfer
          </Button>
        </>
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

  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: itemsApi.getCategories });

  const [form, setForm] = useState({
    name: "", description: "", category_id: "", unit: "", unit_cost: "", reorder_level: "", supplier: "", notes: "",
  });

  const doScan = useCallback(async (value: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type !== "item") { toast.error("Scan an item QR — this is a rack barcode"); return; }
      if (result.result_type === "item") {
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
      }
    } catch { toast.error("Lookup failed. Try again."); }
    finally { setLoading(false); setTimeout(() => { processingRef.current = false; }, 500); }
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
    } finally { setSaving(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Settings2 size={16} className="text-purple-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">Modify Item</h3>
      </div>

      {step === "scan-item" && (
        <ScanPrompt label="Scan item QR to load its details" onScan={doScan} loading={loading} />
      )}

      {step === "edit-form" && scannedItem && (
        <div className="space-y-3">
          <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl flex items-center gap-3">
            <PenLine size={16} className="text-purple-400 shrink-0" />
            <div>
              <p className="text-xs text-purple-400 font-medium">Editing</p>
              <p className="text-sm text-slate-200 font-semibold">{scannedItem.name}</p>
              <p className="font-mono text-xs text-slate-400">{scannedItem.code}</p>
            </div>
          </div>

          <Input label="Name" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
          <Input label="Description" value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} />

          <label className="block text-sm text-slate-300">
            Category
            <select
              value={form.category_id}
              onChange={(e) => setForm(p => ({ ...p, category_id: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">No category</option>
              {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Unit" value={form.unit} onChange={(e) => setForm(p => ({ ...p, unit: e.target.value }))} />
            <Input label="Unit Cost ($)" type="number" value={form.unit_cost} onChange={(e) => setForm(p => ({ ...p, unit_cost: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Reorder Level" type="number" value={form.reorder_level} onChange={(e) => setForm(p => ({ ...p, reorder_level: e.target.value }))} />
            <Input label="Supplier" value={form.supplier} onChange={(e) => setForm(p => ({ ...p, supplier: e.target.value }))} />
          </div>
          <Input label="Notes" value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} />

          <Button fullWidth size="lg" loading={saving} onClick={save}
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

export function Scan() {
  const [mode, setMode] = useState<ScanMode | null>(null);

  const ICONS: Record<ScanMode, React.ElementType> = {
    add: ArrowUpRight, remove: ArrowDownRight, transfer: ArrowLeftRight, modify: Settings2,
  };
  const COLORS: Record<ScanMode, string> = {
    add: "emerald", remove: "red", transfer: "blue", modify: "purple",
  };

  const Icon = mode ? ICONS[mode] : null;
  const color = mode ? COLORS[mode] : "brand";

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto">
      {/* Header */}
      <div className={clsx(
        "px-4 py-3 border-b border-surface-border flex items-center gap-3",
      )}>
        {mode && (
          <button onClick={() => setMode(null)} className="text-slate-400 hover:text-white transition-colors">
            <RotateCcw size={18} />
          </button>
        )}
        {Icon && (
          <div className={`w-7 h-7 rounded-lg bg-${color}-500/20 flex items-center justify-center shrink-0`}>
            <Icon size={15} className={`text-${color}-400`} />
          </div>
        )}
        {!mode && <Package size={18} className="text-slate-400" />}
        <h2 className="text-base font-semibold text-white flex-1">
          {mode ? MODES.find(m => m.id === mode)?.label + " — Scanner" : "Scanner Workflow"}
        </h2>
        {mode && (
          <Badge
            variant={mode === "add" ? "success" : mode === "remove" ? "danger" : mode === "transfer" ? "info" : "default"}
            className="text-xs capitalize"
          >
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
