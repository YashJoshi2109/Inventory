import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import {
  ArrowUpRight, ArrowDownRight, ArrowLeftRight,
  CheckCircle2, XCircle, RotateCcw, Package, MapPin,
} from "lucide-react";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { scanApi } from "@/api/transactions";
import type { ScanResult } from "@/types";

type WorkflowMode = "select" | "stock-in" | "stock-out" | "transfer";
type ScanStep =
  | "scan-location"
  | "scan-item"
  | "confirm"
  | "scan-dest-location"
  | "done";

interface WorkflowState {
  mode: WorkflowMode;
  step: ScanStep;
  location: ScanResult | null;
  item: ScanResult | null;
  destLocation: ScanResult | null;
  quantity: string;
  reference: string;
  borrower: string;
  notes: string;
  scanSessionId: string;
  lastEvent: unknown | null;
}

const INITIAL_STATE: WorkflowState = {
  mode: "select",
  step: "scan-location",
  location: null,
  item: null,
  destLocation: null,
  quantity: "1",
  reference: "",
  borrower: "",
  notes: "",
  scanSessionId: crypto.randomUUID(),
  lastEvent: null,
};

export function Scan() {
  const [state, setState] = useState<WorkflowState>(INITIAL_STATE);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleScan = useCallback(
    async (value: string) => {
      if (loading) return;
      setLoading(true);

      try {
        const result = await scanApi.lookup(value);

        if (result.result_type === "unknown") {
          toast.error(`Unknown barcode: ${value}`);
          return;
        }

        setState((prev) => {
          if (prev.step === "scan-location" && result.result_type === "location") {
            return { ...prev, location: result, step: "scan-item" };
          }
          if (prev.step === "scan-item" && result.result_type === "item") {
            return { ...prev, item: result, step: "confirm" };
          }
          if (prev.step === "scan-dest-location" && result.result_type === "location") {
            return { ...prev, destLocation: result, step: "confirm" };
          }
          return prev;
        });

        // Haptic feedback on mobile
        if (navigator.vibrate) navigator.vibrate(50);
      } catch {
        toast.error("Scan error. Try again.");
      } finally {
        setLoading(false);
        setScanning(false);
      }
    },
    [loading]
  );

  const commit = async () => {
    if (!state.item?.id || !state.location?.id) return;
    setLoading(true);

    try {
      if (state.mode === "stock-in") {
        await scanApi.stockIn({
          item_id: state.item.id,
          location_id: state.location.id,
          quantity: parseFloat(state.quantity),
          reference: state.reference || undefined,
          notes: state.notes || undefined,
          scan_session_id: state.scanSessionId,
        });
      } else if (state.mode === "stock-out") {
        await scanApi.stockOut({
          item_id: state.item.id,
          location_id: state.location.id,
          quantity: parseFloat(state.quantity),
          reference: state.reference || undefined,
          borrower: state.borrower || undefined,
          notes: state.notes || undefined,
          scan_session_id: state.scanSessionId,
        });
      } else if (state.mode === "transfer" && state.destLocation?.id) {
        await scanApi.transfer({
          item_id: state.item.id,
          from_location_id: state.location.id,
          to_location_id: state.destLocation.id,
          quantity: parseFloat(state.quantity),
          notes: state.notes || undefined,
          scan_session_id: state.scanSessionId,
        });
      }

      toast.success("Transaction recorded");
      setState({ ...INITIAL_STATE, mode: state.mode, scanSessionId: crypto.randomUUID() });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (typeof msg === "object" && msg !== null && "code" in msg) {
        const detail = msg as { code: string; available: number; message: string };
        toast.error(`${detail.code}: Only ${detail.available} available`);
      } else {
        toast.error(typeof msg === "string" ? msg : "Transaction failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const reset = () => setState(INITIAL_STATE);

  if (state.mode === "select") {
    return <ModeSelect onSelect={(mode) => setState({ ...INITIAL_STATE, mode })} />;
  }

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-border flex items-center gap-3">
        <button onClick={reset} className="text-slate-400 hover:text-white">
          <RotateCcw size={18} />
        </button>
        <h2 className="text-base font-semibold text-white flex-1">
          {state.mode === "stock-in" && "Stock In"}
          {state.mode === "stock-out" && "Stock Out"}
          {state.mode === "transfer" && "Transfer"}
        </h2>
        <StepIndicator mode={state.mode} step={state.step} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Location scanned */}
        {state.location && (
          <ScanResultCard result={state.location} label="Location" />
        )}

        {/* Item scanned */}
        {state.item && (
          <ScanResultCard result={state.item} label="Item" />
        )}

        {/* Dest location (transfer only) */}
        {state.destLocation && (
          <ScanResultCard result={state.destLocation} label="Destination" />
        )}

        {/* Scanner or confirmation */}
        {state.step !== "confirm" && state.step !== "done" ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-400 text-center">
              {state.step === "scan-location" && "Scan the location / bin label"}
              {state.step === "scan-item" && "Scan the item barcode"}
              {state.step === "scan-dest-location" && "Scan the destination location"}
            </p>

            {scanning ? (
              <BarcodeScanner
                onScan={(v) => { handleScan(v); }}
                className="h-52 w-full"
                autoStart
              />
            ) : (
              <Button fullWidth onClick={() => setScanning(true)} size="lg" leftIcon={<Package size={18} />}>
                Open Camera
              </Button>
            )}

            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-surface-border" />
              <span className="text-xs text-slate-500">or enter manually</span>
              <div className="flex-1 h-px bg-surface-border" />
            </div>

            <ManualEntry onSubmit={handleScan} />
          </div>
        ) : state.step === "confirm" ? (
          <ConfirmForm
            state={state}
            onQuantityChange={(q) => setState((p) => ({ ...p, quantity: q }))}
            onReferenceChange={(r) => setState((p) => ({ ...p, reference: r }))}
            onBorrowerChange={(b) => setState((p) => ({ ...p, borrower: b }))}
            onNotesChange={(n) => setState((p) => ({ ...p, notes: n }))}
            onScanDestination={
              state.mode === "transfer" && !state.destLocation
                ? () => setState((p) => ({ ...p, step: "scan-dest-location" }))
                : undefined
            }
            onCommit={commit}
            loading={loading}
          />
        ) : null}
      </div>
    </div>
  );
}

function ModeSelect({ onSelect }: { onSelect: (mode: WorkflowMode) => void }) {
  const modes = [
    {
      mode: "stock-in" as const,
      label: "Stock In",
      description: "Receive items into a location",
      icon: ArrowUpRight,
      color: "bg-emerald-600 hover:bg-emerald-700",
    },
    {
      mode: "stock-out" as const,
      label: "Stock Out",
      description: "Remove items from inventory",
      icon: ArrowDownRight,
      color: "bg-red-600 hover:bg-red-700",
    },
    {
      mode: "transfer" as const,
      label: "Transfer",
      description: "Move between locations",
      icon: ArrowLeftRight,
      color: "bg-blue-600 hover:bg-blue-700",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 pb-24 space-y-4 max-w-sm mx-auto">
      <h2 className="text-xl font-bold text-white">Select Operation</h2>
      <p className="text-sm text-slate-400 text-center mb-2">Choose the type of inventory transaction</p>
      {modes.map(({ mode, label, description, icon: Icon, color }) => (
        <button
          key={mode}
          onClick={() => onSelect(mode)}
          className={clsx(
            "w-full flex items-center gap-4 p-4 rounded-xl text-white transition-all",
            "active:scale-[0.98]",
            color
          )}
        >
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
            <Icon size={20} />
          </div>
          <div className="text-left">
            <p className="font-semibold">{label}</p>
            <p className="text-sm text-white/70">{description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function ScanResultCard({ result, label }: { result: ScanResult; label: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
      <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="success" className="text-xs">{label}</Badge>
          <span className="text-xs text-slate-400 font-mono">{result.code}</span>
        </div>
        <p className="text-sm text-slate-200 font-medium mt-0.5 truncate">{result.name}</p>
        {result.result_type === "item" && typeof result.details.total_quantity === "number" && (
          <p className="text-xs text-slate-500">
            Current stock: {result.details.total_quantity} {String(result.details.unit ?? "")}
          </p>
        )}
      </div>
    </div>
  );
}

function ManualEntry({ onSubmit }: { onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
      className="flex gap-2"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter barcode manually..."
        className="flex-1"
      />
      <Button type="submit" variant="secondary">Go</Button>
    </form>
  );
}

function ConfirmForm({
  state, onQuantityChange, onReferenceChange, onBorrowerChange, onNotesChange, onScanDestination, onCommit, loading,
}: {
  state: WorkflowState;
  onQuantityChange: (q: string) => void;
  onReferenceChange: (r: string) => void;
  onBorrowerChange: (b: string) => void;
  onNotesChange: (n: string) => void;
  onScanDestination?: () => void;
  onCommit: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-200">Confirm Transaction</h3>

      {state.mode === "transfer" && !state.destLocation && onScanDestination && (
        <Button fullWidth onClick={onScanDestination} variant="secondary" leftIcon={<MapPin size={16} />}>
          Scan Destination Location
        </Button>
      )}

      <Input
        label="Quantity"
        type="number"
        min="0.001"
        step="any"
        value={state.quantity}
        onChange={(e) => onQuantityChange(e.target.value)}
      />

      <Input
        label="Reference / Project (optional)"
        placeholder="EXP-2026-001"
        value={state.reference}
        onChange={(e) => onReferenceChange(e.target.value)}
      />

      {state.mode === "stock-out" && (
        <Input
          label="Borrower (optional)"
          placeholder="Dr. Smith"
          value={state.borrower}
          onChange={(e) => onBorrowerChange(e.target.value)}
        />
      )}

      <Input
        label="Notes (optional)"
        value={state.notes}
        onChange={(e) => onNotesChange(e.target.value)}
      />

      <Button
        fullWidth
        size="lg"
        variant={state.mode === "stock-out" ? "danger" : state.mode === "transfer" ? "primary" : "success"}
        onClick={onCommit}
        loading={loading}
        disabled={
          !state.item || !state.location ||
          (state.mode === "transfer" && !state.destLocation) ||
          !state.quantity || parseFloat(state.quantity) <= 0
        }
      >
        Confirm {state.mode.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
      </Button>
    </div>
  );
}

function StepIndicator({ mode, step }: { mode: WorkflowMode; step: ScanStep }) {
  const steps =
    mode === "transfer"
      ? ["scan-location", "scan-item", "scan-dest-location", "confirm"]
      : ["scan-location", "scan-item", "confirm"];

  return (
    <div className="flex gap-1">
      {steps.map((s, i) => (
        <div
          key={s}
          className={clsx(
            "w-2 h-2 rounded-full",
            s === step ? "bg-brand-400" : steps.indexOf(step) > i ? "bg-emerald-500" : "bg-slate-600"
          )}
        />
      ))}
    </div>
  );
}
