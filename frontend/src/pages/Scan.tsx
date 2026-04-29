import { useCallback, useEffect, useRef, useState, useMemo, type ComponentType, Suspense, lazy } from "react";
import { useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { useThemeStore } from "@/store/theme";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = ComponentType<any>;
import toast from "react-hot-toast";
import {
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Settings2,
  CheckCircle2, RotateCcw, Package, MapPin, QrCode,
  ChevronRight, Loader2, Plus, PenLine, Zap, List, Mail,
} from "lucide-react";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { scanApi } from "@/api/transactions";
import { itemsApi } from "@/api/items";
import { apiClient } from "@/api/client";
import type { ScanResult, Area, Location, StockLevel } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { openOrDownloadDataUrl } from "@/utils/fileActions";
import { useHaptic } from "@/hooks/useHaptic";

type WorkerAction = "idle" | "add" | "remove" | "transfer" | "modify";

function apiErrMsg(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return (detail as { msg: string }[]).map((d) => d.msg).join(", ");
  return fallback;
}

async function safeStockLevels(item_id: number): Promise<StockLevel[]> {
  try {
    return await itemsApi.getStockLevels(item_id);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return [];
    throw err;
  }
}

const levelToScanResult = (level: StockLevel): ScanResult => ({
  id: level.location_id,
  code: level.location_code,
  name: level.location_name,
  result_type: "location",
  details: {
    total_quantity: level.quantity,
    unit: "units",
  },
});

function StockLevelPicker({
  levels,
  onSelect,
  onScanInstead,
  label,
}: {
  levels: StockLevel[];
  onSelect: (level: StockLevel) => void;
  onScanInstead?: () => void;
  label: string;
}) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>{label}</p>
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {levels.filter(l => l.quantity > 0).length === 0 ? (
          <div className="py-8 text-center rounded-xl" style={{ border: "1px dashed var(--border-card)" }}>
            <Package className="mx-auto mb-2" size={24} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>No stock found in any location</p>
          </div>
        ) : (
          levels.filter(l => l.quantity > 0).map((level) => (
            <button
              key={level.location_id}
              onClick={() => onSelect(level)}
              className="w-full flex items-center justify-between p-4 rounded-xl transition-all"
              style={{
                background: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.75)",
                backdropFilter: "blur(12px)",
                border: "1px solid var(--border-card)",
                boxShadow: isDark ? "0 1px 0 rgba(255,255,255,0.10) inset" : "0 1px 0 rgba(255,255,255,0.95) inset",
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(37,99,235,0.10)", border: "1px solid rgba(37,99,235,0.22)" }}>
                  <MapPin size={14} style={{ color: "var(--accent)" }} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{level.location_name}</p>
                  <p className="text-[10px] font-mono italic" style={{ color: "var(--text-muted)" }}>Rack ID: {level.location_id}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-base font-black" style={{ color: "var(--accent)" }}>{level.quantity}</p>
                <p className="text-[9px] uppercase tracking-tighter" style={{ color: "var(--text-muted)" }}>Available</p>
              </div>
            </button>
          ))
        )}
      </div>
      {onScanInstead && (
        <button
          onClick={onScanInstead}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs transition-all"
          style={{
            border: "1px solid var(--border-card)",
            background: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.75)",
            color: "var(--text-muted)",
          }}
        >
          <QrCode size={14} /> Scan different rack QR
        </button>
      )}
    </div>
  );
}

const Inventory3DPanel = lazy(async () => {
  const mod = await import("@/components/visualization/Inventory3DPanel");
  return { default: mod.Inventory3DPanel };
});

type ScanMode = "add" | "remove" | "transfer" | "modify";

// ─── Mode Selector ────────────────────────────────────────────────────────────

const MODES: Array<{
  id: ScanMode;
  label: string;
  icon: IconComponent;
  accentHex: string;
  borderColor: string;
  bgColor: string;
  glowColor: string;
  desc: string;
}> = [
  {
    id: "add",
    label: "Add",
    icon: ArrowUpRight,
    accentHex: "#059669",
    borderColor: "rgba(5,150,105,0.30)",
    bgColor: "rgba(5,150,105,0.10)",
    glowColor: "rgba(5,150,105,0.20)",
    desc: "Add stock to a rack",
  },
  {
    id: "remove",
    label: "Remove",
    icon: ArrowDownRight,
    accentHex: "#DC2626",
    borderColor: "rgba(220,38,38,0.30)",
    bgColor: "rgba(220,38,38,0.10)",
    glowColor: "rgba(220,38,38,0.20)",
    desc: "Remove items from inventory",
  },
  {
    id: "transfer",
    label: "Transfer",
    icon: ArrowLeftRight,
    accentHex: "#2563EB",
    borderColor: "rgba(37,99,235,0.30)",
    bgColor: "rgba(37,99,235,0.10)",
    glowColor: "rgba(37,99,235,0.20)",
    desc: "Move between racks",
  },
  {
    id: "modify",
    label: "Modify",
    icon: Settings2,
    accentHex: "#7C3AED",
    borderColor: "rgba(124,58,237,0.30)",
    bgColor: "rgba(124,58,237,0.10)",
    glowColor: "rgba(124,58,237,0.20)",
    desc: "Edit item details",
  },
];

function ModeSelector({ onSelect }: { onSelect: (m: ScanMode) => void }) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  return (
    <div className="h-full w-full flex items-center justify-center p-4 overflow-y-auto">
      <div className="grid grid-cols-2 md:flex md:flex-row gap-3 md:gap-4 w-full max-w-3xl">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onSelect(m.id as ScanMode)}
            className="group relative flex flex-col items-center justify-center gap-3 rounded-2xl transition-all duration-300 overflow-hidden hover:scale-[1.03] active:scale-[0.97] md:flex-1 py-6 md:py-8"
            style={{
              background: `linear-gradient(140deg, ${m.bgColor} 0%, ${isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.92)"} 60%, ${m.bgColor.replace("0.10","0.04")} 100%)`,
              backdropFilter: "blur(24px) saturate(1.8)",
              WebkitBackdropFilter: "blur(24px) saturate(1.8)",
              borderTop: isDark ? "1px solid rgba(255,255,255,0.20)" : "1px solid rgba(255,255,255,0.95)",
              borderLeft: isDark ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(255,255,255,0.80)",
              borderRight: `1px solid ${m.borderColor}`,
              borderBottom: `1px solid ${m.borderColor}`,
              boxShadow: `0 1px 0 ${isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.95)"} inset, 0 8px 32px -4px ${m.glowColor}, 0 2px 8px rgba(10,20,60,0.08)`,
            }}
          >
            {/* Ambient glow orb */}
            <div className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none opacity-30 group-hover:opacity-60 transition-opacity duration-500"
              style={{background:`radial-gradient(ellipse at 50% 100%, ${m.glowColor}, transparent 70%)`}} />

            {/* Icon container */}
            <div className="relative w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:-rotate-6"
              style={{
                background: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.88)",
                backdropFilter: "blur(12px)",
                border: `1.5px solid ${m.borderColor}`,
                boxShadow: `0 0 20px -4px ${m.glowColor}, 0 1px 0 ${isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.95)"} inset`,
              }}>
              <m.icon className="w-6 h-6 md:w-7 md:h-7" style={{ color: m.accentHex }} />
            </div>

            <div className="text-center mt-1 z-10 px-2">
              <p className="text-[13px] md:text-[15px] font-black tracking-[0.12em] uppercase leading-tight"
                style={{ color: "var(--text-primary)" }}>{m.label}</p>
              <p className="text-[10px] md:text-[11px] transition-colors mt-1.5 leading-snug max-w-[140px] mx-auto"
                style={{ color: "var(--text-muted)" }}>{m.desc}</p>
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
          <span className="text-xs font-mono truncate" style={{ color: "var(--text-muted)" }}>{result.code}</span>
        </div>
        <p className="text-sm font-semibold mt-1 truncate" style={{ color: "var(--text-primary)" }}>{result.name}</p>
        {result.result_type === "item" && typeof result.details?.total_quantity === "number" && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Stock: <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
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
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState("");
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);

  // Prevent the scanner from calling onScan multiple times before unmount
  const firedRef = useRef(false);
  const attemptRef = useRef(0);
  const lastCodeRef = useRef("");
  const prevLoadingRef = useRef(false);

  // Track loading transitions — after 2 failures for same code, show not-found UI
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      // Request just completed (loading true→false)
      attemptRef.current += 1;
      if (attemptRef.current >= 2) {
        // Two attempts exhausted — surface not-found UI, keep firedRef locked
        setNotFoundCode(lastCodeRef.current);
      } else {
        // Allow one retry
        firedRef.current = false;
      }
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  const handleScan = useCallback(
    (v: string) => {
      if (firedRef.current) return;
      firedRef.current = true;
      // Reset attempt count when a different code is scanned
      if (v !== lastCodeRef.current) {
        lastCodeRef.current = v;
        attemptRef.current = 0;
        setNotFoundCode(null);
      }
      setCamera(false);
      onScan(v);
    },
    [onScan],
  );

  const handleTryAgain = () => {
    setNotFoundCode(null);
    firedRef.current = false;
    attemptRef.current = 0;
    lastCodeRef.current = "";
    setCamera(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-center" style={{ color: "var(--text-muted)" }}>{label}</p>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Processing…</p>
        </div>
      ) : notFoundCode ? (
        <div className="flex flex-col items-center gap-4 py-6 px-4 rounded-2xl"
          style={{
            background: `linear-gradient(140deg, rgba(239,68,68,0.06) 0%, ${isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.88)"} 100%)`,
            backdropFilter: "blur(16px) saturate(1.6)",
            WebkitBackdropFilter: "blur(16px) saturate(1.6)",
            borderTop: isDark ? "1px solid rgba(255,255,255,0.20)" : "1px solid rgba(255,255,255,0.95)",
            borderLeft: isDark ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(255,255,255,0.80)",
            borderRight: "1px solid rgba(239,68,68,0.20)",
            borderBottom: "1px solid rgba(239,68,68,0.20)",
            boxShadow: `0 1px 0 ${isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.95)"} inset`,
          }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.25)" }}>
            <Package size={24} style={{ color: "#ef4444" }} />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Item not found in inventory</p>
            <p className="text-xs font-mono px-3 py-1.5 rounded-lg"
              style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)" }}>
              {notFoundCode}
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              This code is not registered in the system.
            </p>
          </div>
          <button
            onClick={handleTryAgain}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.88)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "var(--text-primary)",
            }}>
            <RotateCcw size={14} />
            Scan a different code
          </button>
        </div>
      ) : camera ? (
        <BarcodeScanner
          onScan={handleScan}
          hint={hint ?? "Point at item QR code"}
          className="h-44 w-full rounded-2xl"
          autoStart
        />
      ) : (
        <button
          onClick={() => setCamera(true)}
          className="w-full flex flex-col items-center gap-3 py-8 rounded-2xl transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: `linear-gradient(140deg, rgba(37,99,235,0.10) 0%, ${isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.88)"} 60%, rgba(37,99,235,0.04) 100%)`,
            backdropFilter: "blur(16px) saturate(1.6)",
            WebkitBackdropFilter: "blur(16px) saturate(1.6)",
            borderTop: isDark ? "1px solid rgba(255,255,255,0.20)" : "1px solid rgba(255,255,255,0.95)",
            borderLeft: isDark ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(255,255,255,0.80)",
            borderRight: "1px solid rgba(37,99,235,0.25)",
            borderBottom: "1px solid rgba(37,99,235,0.25)",
            boxShadow: `0 1px 0 ${isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.95)"} inset, 0 4px 20px rgba(37,99,235,0.12)`,
          }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.88)",
              backdropFilter: "blur(12px)",
              border: "1.5px solid rgba(37,99,235,0.30)",
              boxShadow: `0 0 20px rgba(37,99,235,0.15), 0 1px 0 ${isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.95)"} inset`,
            }}
          >
            <QrCode size={28} style={{ color: "var(--accent)" }} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Open Camera</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Tap to activate scanner</p>
          </div>
        </button>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} />
        <span className="text-xs px-1" style={{ color: "var(--text-muted)" }}>or type manually</span>
        <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} />
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
      <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{label}</h3>
    </div>
  );
}

// ─── ADD WORKFLOW ─────────────────────────────────────────────────────────────

export interface SmartScanPrefill {
  name: string;
  sku: string;
  category: string;   // category name — matched to ID after categories load
  unit: string;
  quantity: number;
  description: string;
  supplier: string;
}

type AddSubType = "add-stock" | "new-item";
type AddStep = "select-subtype" | "scan-item" | "scan-rack" | "confirm" | "fill-details";

function AddFlow({
  onReset,
  onPhaseChange,
  onLocationFound,
  prefill,
}: {
  onReset: () => void;
  onPhaseChange?: (phase: string) => void;
  onLocationFound?: (code: string) => void;
  prefill?: SmartScanPrefill | null;
}) {
  const [subtype, setSubtype] = useState<AddSubType | null>(() => prefill ? "new-item" : null);
  const [step, setStep] = useState<AddStep>(() => prefill ? "scan-rack" : "select-subtype");
  const [scannedRack, setScannedRack] = useState<ScanResult | null>(null);
  const [scannedItem, setScannedItem] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState(() => prefill ? String(prefill.quantity || 1) : "1");
  const [notes, setNotes] = useState("");
  const [newItemForm, setNewItemForm] = useState({
    sku: prefill?.sku ?? "",
    name: prefill?.name ?? "",
    category_id: "",
    unit: prefill?.unit || "EA",
    unit_cost: "",
    supplier: prefill?.supplier ?? "",
    description: prefill?.description ?? "",
  });
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const processingRef = useRef(false);

  // Load categories for new-item form; auto-match prefill category name → id
  useEffect(() => {
    if (subtype === "new-item" && categories.length === 0) {
      itemsApi.getCategories().then((cats) => {
        setCategories(cats);
        if (prefill?.category) {
          const match = cats.find(
            (c) => c.name.toLowerCase() === prefill.category.toLowerCase()
          );
          if (match) setNewItemForm((f) => ({ ...f, category_id: String(match.id) }));
        }
      }).catch(() => {});
    }
  }, [subtype, categories.length, prefill]);

  const go = (newStep: AddStep) => { setStep(newStep); onPhaseChange?.(newStep); };

  const pickSubtype = (st: AddSubType) => {
    setSubtype(st);
    // add-stock: scan item first; new-item: scan rack first
    go(st === "add-stock" ? "scan-item" : "scan-rack");
  };

  // ── add-stock: scan item QR first ────────────────────────────────────────────
  const doItemScan = useCallback(async (value: string) => {
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
      go("scan-rack");
      toast.success(`Item: ${result.name}`);
    } catch {
      toast.error("Lookup failed. Try again.");
    } finally {
      setLoading(false);
      setTimeout(() => { processingRef.current = false; }, 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPhaseChange]);

  // ── scan rack QR (both subtypes use this) ────────────────────────────────────
  const doRackScan = useCallback(async (value: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type !== "location") {
        toast.error("Scan a rack QR code — this is an item barcode");
        return;
      }
      setScannedRack(result);
      onLocationFound?.(result.code);
      go(subtype === "add-stock" ? "confirm" : "fill-details");
      toast.success(`Location: ${result.name}`);
    } catch {
      toast.error("Lookup failed. Try again.");
    } finally {
      setLoading(false);
      setTimeout(() => { processingRef.current = false; }, 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPhaseChange, subtype]);

  // ── add-stock: commit ─────────────────────────────────────────────────────────
  const commit = async () => {
    if (!scannedRack || !scannedItem) return;
    setLoading(true);
    try {
      await scanApi.add({
        location_id: scannedRack.id!,
        item_id: scannedItem.id!,
        quantity: parseFloat(qty),
        notes: notes || undefined,
      });
      toast.success(`✓ Added ${qty} × ${scannedItem.name} to ${scannedRack.code}`);
      onReset();
    } catch {
      toast.error("Add failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── new-item: create item + add to rack ───────────────────────────────────────
  const commitNewItem = async () => {
    if (!scannedRack || !newItemForm.name.trim() || !newItemForm.sku.trim()) return;
    setLoading(true);
    try {
      const created = await itemsApi.create({
        sku: newItemForm.sku.trim(),
        name: newItemForm.name.trim(),
        description: newItemForm.description || undefined,
        category_id: newItemForm.category_id ? parseInt(newItemForm.category_id) : undefined,
        unit: newItemForm.unit || "EA",
        unit_cost: newItemForm.unit_cost ? parseFloat(newItemForm.unit_cost) : undefined,
        supplier: newItemForm.supplier || undefined,
      });
      await scanApi.add({
        location_id: scannedRack.id!,
        item_id: created.id,
        quantity: parseFloat(qty) || 1,
        notes: notes || undefined,
      });
      toast.success(`✓ Created "${created.name}" and added to ${scannedRack.code}`);
      // Offer to email the QR
      try {
        await itemsApi.sendQrToEmail(created.id);
        toast.success("QR code sent to your email");
      } catch { /* email optional */ }
      onReset();
    } catch (err) {
      toast.error(apiErrMsg(err, "Failed to create item."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <FlowHeader icon={ArrowUpRight} label="Add Stock" accent="#34d399" />

      {/* ── Step 0: choose subtype ── */}
      {step === "select-subtype" && (
        <div className="grid grid-cols-2 gap-3 mt-2">
          {[
            {
              id: "add-stock" as AddSubType,
              icon: <QrCode size={28} className="text-emerald-400" />,
              title: "Add stock",
              desc: "Scan item QR, then shelf QR",
              accent: "#34d399",
              border: "rgba(52,211,153,0.25)",
              bg: "rgba(52,211,153,0.06)",
            },
            {
              id: "new-item" as AddSubType,
              icon: <Plus size={28} style={{ color: "var(--accent)" }} />,
              title: "New Item",
              desc: "Scan shelf → details → QR",
              accent: "#22d3ee",
              border: "rgba(34,211,238,0.25)",
              bg: "rgba(34,211,238,0.06)",
            },
          ].map((opt) => (
            <button key={opt.id} onClick={() => pickSubtype(opt.id)}
              className="group relative flex flex-col items-center justify-center gap-3 rounded-2xl border py-6 px-4 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] overflow-hidden"
              style={{ borderColor: opt.border, background: opt.bg, boxShadow: `0 4px 24px -6px ${opt.accent}30` }}>
              <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none opacity-20 group-hover:opacity-50 transition-opacity"
                style={{ background: `radial-gradient(ellipse 80% 60% at 50% 100%,${opt.accent}80,transparent)` }} />
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"
                style={{ background: opt.bg, border: `1.5px solid ${opt.border}` }}>
                {opt.icon}
              </div>
              <div className="text-center">
                <p className="text-[15px] font-black tracking-wide" style={{ color: "var(--text-primary)" }}>{opt.title}</p>
                <p className="text-[11px] mt-1 transition-colors" style={{ color: "var(--text-muted)" }}>{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── add-stock: Step 1 — scan item QR ── */}
      {step === "scan-item" && subtype === "add-stock" && (
        <div className="space-y-3">
          <ScanPrompt label="Scan the Item QR" hint="Point at item barcode / QR code" onScan={doItemScan} loading={loading} />
          <button onClick={() => go("select-subtype")} className="w-full text-center text-xs transition-colors" style={{ color: "var(--text-muted)" }}>
            ← Back
          </button>
        </div>
      )}

      {/* ── add-stock / new-item: scan rack QR ── */}
      {step === "scan-rack" && (
        <div className="space-y-3">
          {prefill && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
              style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}>
              <CheckCircle2 size={14} className="shrink-0" style={{ color: "var(--accent-violet)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: "var(--accent-violet)" }}>Smart Scan prefill active</p>
                <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{prefill.name} · {prefill.sku}</p>
              </div>
            </div>
          )}
          {scannedItem && <ScannedCard result={scannedItem} label="Item" accent="#fbbf24" />}
          <ScanPrompt label="Scan Destination Shelf QR" hint="Point at rack / location QR" onScan={doRackScan} loading={loading} />
          <button onClick={() => go(subtype === "add-stock" ? "scan-item" : "select-subtype")}
            className="w-full text-center text-xs transition-colors" style={{ color: "var(--text-muted)" }}>
            ← Back
          </button>
        </div>
      )}

      {/* ── add-stock: confirm ── */}
      {step === "confirm" && scannedRack && scannedItem && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ScannedCard result={scannedItem} label="Item" accent="#fbbf24" />
            <ScannedCard result={scannedRack} label="To Rack" accent="#34d399" />
          </div>

          <div className="space-y-3">
            <Input
              label="Quantity to Add"
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
            Confirm Addition
          </Button>

          <div className="flex justify-between items-center px-1">
            <button
              onClick={() => go("scan-item")}
              className="text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Change item
            </button>
            <button
              onClick={onReset}
              className="text-xs"
              style={{ color: "var(--accent-danger)", opacity: 0.6 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── new-item: fill details ── */}
      {step === "fill-details" && scannedRack && (
        <div className="space-y-3">
          <ScannedCard result={scannedRack} label="Destination" accent="#34d399" />

          <div className="space-y-2">
            <Input
              label="SKU *"
              placeholder="e.g. EL-CAP-100"
              value={newItemForm.sku}
              onChange={(e) => setNewItemForm((f) => ({ ...f, sku: e.target.value }))}
            />
            <Input
              label="Name *"
              placeholder="e.g. 100µF Capacitor"
              value={newItemForm.name}
              onChange={(e) => setNewItemForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Category</label>
                <select
                  value={newItemForm.category_id}
                  onChange={(e) => setNewItemForm((f) => ({ ...f, category_id: e.target.value }))}
                  className="w-full rounded-xl text-sm px-3 py-2 focus:outline-none focus:border-cyan-400/50"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
                >
                  <option value="">— none —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <Input
                  label="Unit"
                  placeholder="EA"
                  value={newItemForm.unit}
                  onChange={(e) => setNewItemForm((f) => ({ ...f, unit: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  label="Unit Cost ($)"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={newItemForm.unit_cost}
                  onChange={(e) => setNewItemForm((f) => ({ ...f, unit_cost: e.target.value }))}
                />
              </div>
              <div className="flex-1">
                <Input
                  label="Initial Qty"
                  type="number"
                  min="1"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            </div>
            <Input
              label="Supplier"
              placeholder="optional"
              value={newItemForm.supplier}
              onChange={(e) => setNewItemForm((f) => ({ ...f, supplier: e.target.value }))}
            />
          </div>

          <Button fullWidth size="lg" variant="primary" loading={loading} onClick={commitNewItem}
            disabled={!newItemForm.name.trim() || !newItemForm.sku.trim()}>
            Create &amp; Add to Shelf
          </Button>

          <div className="flex justify-between items-center px-1">
            <button onClick={() => go("scan-rack")} className="text-xs" style={{ color: "var(--text-muted)" }}>
              ← Change shelf
            </button>
            <button onClick={onReset} className="text-xs" style={{ color: "var(--accent-danger)", opacity: 0.6 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── REMOVE WORKFLOW ──────────────────────────────────────────────────────────

type RemoveStep = "scan-item" | "select-location" | "confirm";

function RemoveFlow({
  onReset,
  onPhaseChange,
  onLocationFound,
}: {
  onReset: () => void;
  onPhaseChange?: (phase: string) => void;
  onLocationFound?: (code: string) => void;
}) {
  const [step, setStep] = useState<RemoveStep>("scan-item");
  const [scannedItem, setScannedItem] = useState<ScanResult | null>(null);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [selectedStock, setSelectedStock] = useState<StockLevel | null>(null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const processingRef = useRef(false);

  const setStepWithPhase = (newStep: RemoveStep) => {
    setStep(newStep);
    onPhaseChange?.(newStep);
  };

  const doItemScan = useCallback(async (value: string) => {
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
      const levels = await safeStockLevels(result.id!);
      setStockLevels(levels);
      setStepWithPhase("select-location");
      toast.success(`Loaded item: ${result.name}`);
    } catch (err) {
      toast.error(apiErrMsg(err, "Lookup failed. Try again."));
    } finally {
      setLoading(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 500);
    }
  }, [onPhaseChange]);

  const selectStock = (level: StockLevel) => {
    setSelectedStock(level);
    setQty(String(Math.min(1, level.quantity)));
    onLocationFound?.(level.location_name);
    setStepWithPhase("confirm");
  };

  const commit = async () => {
    if (!scannedItem || !selectedStock) return;
    setLoading(true);
    try {
      await scanApi.remove({
        item_id: scannedItem.id!,
        location_id: selectedStock.location_id,
        quantity: parseFloat(qty),
        notes: notes || undefined,
      });
      toast.success(`✓ Removed ${qty} × ${scannedItem.name} from ${selectedStock.location_name}`);
      onReset();
    } catch (err) {
      toast.error(apiErrMsg(err, "Remove failed. Check if enough stock."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      {step === "scan-item" && (
        <ScanPrompt
          label="Scan the Item QR to remove"
          hint="Point at item QR code"
          onScan={doItemScan}
          loading={loading}
        />
      )}

      {step === "select-location" && scannedItem && (
        <>
          <ScannedCard result={scannedItem} label="Item Selected" accent="#f87171" />
          <StockLevelPicker
            levels={stockLevels}
            onSelect={selectStock}
            label="Pick location to remove from:"
          />
        </>
      )}

      {step === "confirm" && scannedItem && selectedStock && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ScannedCard result={scannedItem} label="Item" accent="#f87171" />
            <div
              className="p-3 rounded-xl space-y-1"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-card)",
              }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                From Location
              </p>
              <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                {selectedStock.location_name}
              </p>
              <p className="text-xs font-mono" style={{ color: "var(--accent)" }}>
                {selectedStock.quantity} in stock
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Input
              label="Quantity to Remove"
              type="number"
              min="0.001"
              max={selectedStock.quantity}
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
            Confirm Removal
          </Button>
          <button
            onClick={() => setStepWithPhase("select-location")}
            className="w-full text-center text-xs transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            ← Back to location list
          </button>
        </div>
      )}
    </div>
  );
}

// ─── TRANSFER WORKFLOW ────────────────────────────────────────────────────────

type TransferStep =
  | "scan-item"
  | "item-loaded"
  | "select-source"
  | "scan-source-rack"
  | "scan-dest-rack"
  | "confirm";

function TransferFlow({
  onReset,
  onPhaseChange,
  onLocationFound,
}: {
  onReset: () => void;
  onPhaseChange?: (phase: string) => void;
  onLocationFound?: (code: string) => void;
}) {
  const [step, setStep] = useState<TransferStep>("scan-item");
  const [item, setItem] = useState<ScanResult | null>(null);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [sourceRack, setSourceRack] = useState<ScanResult | null>(null);
  const [destRack, setDestRack] = useState<ScanResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const processingRef = useRef(false);

  const setStepWithPhase = (newStep: TransferStep) => {
    setStep(newStep);
    onPhaseChange?.(newStep);
  };

  const doItemScan = useCallback(async (value: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type !== "item") {
        toast.error("Scan an item QR — this is a rack barcode");
        return;
      }
      setItem(result);
      const levels = await safeStockLevels(result.id!);
      setStockLevels(levels);
      setStepWithPhase("item-loaded");
      toast.success(`Loaded item: ${result.name}`);
    } catch (err) {
      toast.error(apiErrMsg(err, "Lookup failed. Try again."));
    } finally {
      setLoading(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 500);
    }
  }, [onPhaseChange]);

  const doSourceScan = useCallback(async (value: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type !== "location") {
        toast.error("Scan a rack QR code");
        return;
      }
      setSourceRack(result);
      onLocationFound?.(result.code);
      setStepWithPhase("scan-dest-rack");
      toast.success(`From: ${result.name}`);
    } catch (err) {
      toast.error(apiErrMsg(err, "Lookup failed. Try again."));
    } finally {
      setLoading(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 500);
    }
  }, [onPhaseChange]);

  const doDestScan = useCallback(async (value: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    try {
      const result = await scanApi.lookup(value);
      if (result.result_type !== "location") {
        toast.error("Scan a rack QR code");
        return;
      }
      setDestRack(result);
      setStepWithPhase("confirm");
      toast.success(`Destination: ${result.name}`);
    } catch (err) {
      toast.error(apiErrMsg(err, "Lookup failed. Try again."));
    } finally {
      setLoading(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 500);
    }
  }, [onPhaseChange]);

  const selectSource = (level: StockLevel) => {
    setSourceRack(levelToScanResult(level));
    setQty(String(Math.min(1, level.quantity)));
    setStepWithPhase("scan-dest-rack");
  };

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
    } catch (err) {
      toast.error(apiErrMsg(err, "Transfer failed. Check source has enough stock."));
    } finally {
      setLoading(false);
    }
  };

  const sourceStock = sourceRack
    ? stockLevels.find((l) => l.location_id === sourceRack.id)?.quantity
    : undefined;

  return (
    <div className="p-5 space-y-4">
      {step === "scan-item" && (
        <ScanPrompt
          label="Scan the item QR to transfer"
          hint="Point at item QR code"
          onScan={doItemScan}
          loading={loading}
        />
      )}

      {step === "item-loaded" && item && (
        <div className="space-y-4">
          <ScannedCard result={item} label="Item Loaded" accent="#22d3ee" />
          <div
            className="p-4 rounded-xl space-y-2"
            style={{
              background: "rgba(34,211,238,0.05)",
              border: "1px solid rgba(34,211,238,0.15)",
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
              Item Details
            </p>
            <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{item.name}</p>
            <p className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{item.code}</p>
            {typeof item.details?.total_quantity === "number" && (
              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
                  {item.details.total_quantity}
                </span>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>{item.details?.unit ?? "units"} total in stock</span>
              </div>
            )}
          </div>
          {/* Show stock distribution */}
          {stockLevels.filter((l) => l.quantity > 0).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>Stock by location:</p>
              {stockLevels
                .filter((l) => l.quantity > 0)
                .map((l) => (
                  <div
                    key={l.location_id}
                    className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                    style={{ background: "var(--bg-card)", backdropFilter: "blur(8px)" }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>{l.location_name}</span>
                    <span className="font-semibold" style={{ color: "var(--accent)" }}>{l.quantity}</span>
                  </div>
                ))}
            </div>
          )}
          <button
            onClick={() => setStepWithPhase("select-source")}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(34,211,238,0.2), rgba(8,145,178,0.2))",
              border: "1px solid rgba(34,211,238,0.35)",
              color: "var(--text-primary)",
            }}
          >
            <MapPin size={16} />
            Proceed — Select Source Rack
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {step === "select-source" && item && (
        <>
          <ScannedCard result={item} label="Item" accent="#22d3ee" />
          <StockLevelPicker
            levels={stockLevels}
            onSelect={selectSource}
            onScanInstead={() => setStepWithPhase("scan-source-rack")}
            label="Select SOURCE rack (where item is now):"
          />
        </>
      )}

      {step === "scan-source-rack" && item && (
        <>
          <ScannedCard result={item} label="Item" accent="#22d3ee" />
          <ScanPrompt
            label="Scan the SOURCE rack QR"
            hint="Point at rack / location QR"
            onScan={doSourceScan}
            loading={loading}
          />
          <button
            onClick={() => setStepWithPhase("select-source")}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-colors"
            style={{ border: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
          >
            <List size={14} /> View stock locations instead
          </button>
        </>
      )}

      {step === "scan-dest-rack" && item && sourceRack && (
        <>
          <ScannedCard result={item} label="Item" accent="#22d3ee" />
          <ScannedCard result={sourceRack} label="Source Rack" accent="#f87171" />
          <ScanPrompt
            label="Scan the DESTINATION rack QR"
            hint="Point at rack / location QR"
            onScan={doDestScan}
            loading={loading}
          />
        </>
      )}

      {step === "confirm" && item && sourceRack && destRack && (
        <div className="space-y-4">
          <ScannedCard result={item} label="Item" accent="#22d3ee" />
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ScannedCard result={sourceRack} label="From" accent="#f87171" />
            </div>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: "rgba(34,211,238,0.1)",
                border: "1px solid rgba(34,211,238,0.3)",
              }}
            >
              <ArrowLeftRight size={14} style={{ color: "var(--accent)" }} />
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
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Available at source</span>
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              {sourceStock ?? item.details?.total_quantity ?? "?"}{" "}
              <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>
                {item.details?.unit ?? ""}
              </span>
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
          <button
            onClick={() => setStepWithPhase("select-source")}
            className="w-full text-center text-xs transition-colors py-1"
            style={{ color: "var(--text-muted)" }}
          >
            ← Change source rack
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MODIFY WORKFLOW ──────────────────────────────────────────────────────────

type ModifyStep = "scan-item" | "edit-form";

function ModifyFlow({
  onReset,
  onPhaseChange,
}: {
  onReset: () => void;
  onPhaseChange?: (phase: string) => void;
}) {
  const [step, setStep] = useState<ModifyStep>("scan-item");
  const [scannedItem, setScannedItem] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const processingRef = useRef(false);

  const setStepWithPhase = (newStep: ModifyStep) => {
    setStep(newStep);
    onPhaseChange?.(newStep);
  };

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
      setStepWithPhase("edit-form");
      toast.success(`Loaded: ${result.name}`);
    } catch {
      toast.error("Lookup failed. Try again.");
    } finally {
      setLoading(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 500);
    }
  }, [onPhaseChange]);

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
              backdropFilter: "blur(12px)",
            }}
          >
            <PenLine size={18} className="shrink-0" style={{ color: "var(--accent-violet)" }} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--accent-violet)" }}>
                Editing
              </p>
              <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{scannedItem.name}</p>
              <p className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{scannedItem.code}</p>
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

          <label className="block text-sm" style={{ color: "var(--text-secondary)" }}>
            Category
            <select
              value={form.category_id}
              onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}
              className="mt-1 w-full rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border-card)",
                color: "var(--text-primary)",
                padding: "0.625rem 0.75rem",
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
  const location = useLocation();
  const routePrefill = (location.state as { prefill?: SmartScanPrefill } | null)?.prefill ?? null;

  const [mode, setMode] = useState<ScanMode | null>(() => routePrefill ? "add" : null);
  const [flowPhase, setFlowPhase] = useState("idle");
  const [scannedLocCode, setScannedLocCode] = useState<string | null>(null);

  const meta = mode ? MODE_META[mode] : null;
  const Icon = meta?.icon ?? null;

  const workerAction: WorkerAction = useMemo(() => {
    if (!mode) return "idle";
    return mode as WorkerAction;
  }, [mode]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ maxHeight: "100vh" }}>

      {/* ── TOP: Interactive 3D Storage — landscape, full width ── */}
      <div className="shrink-0 p-3 pb-1.5" style={{ height: "35%" }}>
        <Suspense
          fallback={
            <div className="w-full h-full rounded-2xl flex items-center justify-center"
              style={{
                background: "var(--bg-card)",
                backdropFilter: "blur(24px) saturate(1.8)",
                borderTop: "1px solid var(--border-card)",
                borderLeft: "1px solid var(--border-card)",
                borderRight: "1px solid rgba(180,200,255,0.30)",
                borderBottom: "1px solid rgba(180,200,255,0.30)",
                boxShadow: "var(--shadow-card)",
              }}>
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          }
        >
          <Inventory3DPanel action={workerAction} phaseLabel={flowPhase} focusedLocationCode={scannedLocCode} />
        </Suspense>
      </div>

      {/* ── BOTTOM: Action selector or active workflow ── */}
      <div className="flex-1 min-h-0 overflow-hidden px-3 pb-3 pt-1.5">
        {!mode ? (
          /* ── Four compact action buttons ── */
          <div className="h-full rounded-2xl overflow-hidden"
            style={{
              background: "var(--bg-card)",
              backdropFilter: "blur(24px) saturate(1.8)",
              WebkitBackdropFilter: "blur(24px) saturate(1.8)",
              borderTop: "1px solid var(--border-card)",
              borderLeft: "1px solid var(--border-card)",
              borderRight: "1px solid rgba(180,200,255,0.30)",
              borderBottom: "1px solid rgba(180,200,255,0.30)",
              boxShadow: "var(--shadow-card)",
            }}>
            <ModeSelector onSelect={setMode} />
          </div>
        ) : (
          /* ── Active workflow ── */
          <div className="h-full rounded-2xl flex flex-col overflow-hidden"
            style={{
              background: "var(--bg-card)",
              backdropFilter: "blur(24px) saturate(1.8)",
              WebkitBackdropFilter: "blur(24px) saturate(1.8)",
              borderTop: "1px solid var(--border-card)",
              borderLeft: "1px solid var(--border-card)",
              borderRight: `1px solid ${meta?.accent ?? "rgba(180,200,255,0.30)"}44`,
              borderBottom: `1px solid ${meta?.accent ?? "rgba(180,200,255,0.30)"}44`,
              boxShadow: "var(--shadow-card)",
            }}>
            {/* Mini workflow header */}
            <div className="flex items-center gap-2.5 px-4 py-2 shrink-0"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <button onClick={() => { setMode(null); setFlowPhase("idle"); setScannedLocCode(null); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-105"
                style={{
                  border: "1px solid var(--border-card)",
                  background: "var(--bg-card)",
                  color: "var(--text-muted)",
                }}>
                <RotateCcw size={13} />
              </button>
              {Icon && meta && (
                <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${meta.accent}20`, border: `1px solid ${meta.accent}35` }}>
                  <Icon size={12} style={{ color: meta.accent }} />
                </div>
              )}
              <p className="text-[13px] font-bold flex-1" style={{ color: "var(--text-primary)" }}>
                {meta?.label ?? ""} Workflow
              </p>
              {meta && (
                <Badge variant={meta.badgeVariant} className="text-[10px] capitalize">
                  {mode}
                </Badge>
              )}
            </div>
            {/* Flow content — scrollable only internally */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="max-w-2xl w-full mx-auto px-2 py-2">
                {mode === "add"      && <AddFlow      onReset={() => { setMode(null); setScannedLocCode(null); }} onPhaseChange={setFlowPhase} onLocationFound={setScannedLocCode} prefill={routePrefill} />}
                {mode === "remove"   && <RemoveFlow   onReset={() => { setMode(null); setScannedLocCode(null); }} onPhaseChange={setFlowPhase} onLocationFound={setScannedLocCode} />}
                {mode === "transfer" && <TransferFlow onReset={() => { setMode(null); setScannedLocCode(null); }} onPhaseChange={setFlowPhase} onLocationFound={setScannedLocCode} />}
                {mode === "modify"   && <ModifyFlow   onReset={() => { setMode(null); setScannedLocCode(null); }} onPhaseChange={setFlowPhase} />}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
