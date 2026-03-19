import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  CheckCircle2,
  RotateCcw,
  Package,
  MapPin,
} from "lucide-react";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { scanApi } from "@/api/transactions";
import type { ScanResult } from "@/types";

type WorkflowMode = "stock-in" | "stock-out" | "transfer";
type ScanStep =
  | "scan-item"
  | "scan-rack"
  | "scan-dest-rack"
  | "confirm";

interface WorkflowState {
  mode: WorkflowMode;
  step: ScanStep;
  item: ScanResult | null;
  rack: ScanResult | null;
  destRack: ScanResult | null;
  quantity: string;
  reference: string;
  borrower: string;
  notes: string;
  scanSessionId: string;
  lastEvent: unknown | null;
}

const INITIAL_STATE: WorkflowState = {
  mode: "stock-out",
  step: "scan-item",
  item: null,
  rack: null,
  destRack: null,
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

  const processingRef = useRef(false);

  const handleScan = useCallback(
    async (value: string) => {
      if (processingRef.current) return;
      processingRef.current = true;
      setLoading(true);

      try {
        const result = await scanApi.lookup(value);

        if (result.result_type === "unknown") {
          toast.error(`Unknown barcode: ${value}`);
          return;
        }

        let matched = false;
        setState((prev) => {
          if (prev.step === "scan-item" && result.result_type === "item") {
            matched = true;
            return { ...prev, item: result, step: "scan-rack" };
          }
          if (prev.step === "scan-rack" && result.result_type === "location") {
            matched = true;
            return {
              ...prev,
              rack: result,
              step: prev.mode === "transfer" ? "scan-dest-rack" : "confirm",
            };
          }
          if (prev.step === "scan-dest-rack" && result.result_type === "location") {
            matched = true;
            return { ...prev, destRack: result, step: "confirm" };
          }
          return prev;
        });

        if (matched) {
          toast.success(`Scanned: ${result.name}`);
          if (navigator.vibrate) navigator.vibrate(50);
        } else {
          const expected = state.step === "scan-item" ? "item" : "location (rack)";
          toast.error(`Expected ${expected} barcode, got ${result.result_type}`);
        }
      } catch {
        toast.error("Scan lookup failed. Try again.");
      } finally {
        setLoading(false);
        setScanning(false);
        setTimeout(() => { processingRef.current = false; }, 500);
      }
    },
    [state.step]
  );

  const commit = async () => {
    if (!state.item || !state.rack) return;
    setLoading(true);

    try {
      if (state.mode === "transfer" && !state.destRack) {
        toast.error("Scan destination rack before transfer");
        return;
      }

      await scanApi.apply({
        item_barcode: state.item.code,
        rack_barcode: `LOC:${state.rack.code}`,
        event_type:
          state.mode === "stock-in"
            ? "stock_in"
            : state.mode === "stock-out"
              ? "stock_out"
              : "transfer",
        destination_rack_barcode: state.destRack ? `LOC:${state.destRack.code}` : undefined,
        quantity: parseFloat(state.quantity),
        reference: state.reference || undefined,
        borrower: state.borrower || undefined,
        notes: state.notes || undefined,
        scan_session_id: state.scanSessionId,
      });

      toast.success("Transaction recorded");
      setState({
        ...INITIAL_STATE,
        mode: state.mode,
        scanSessionId: crypto.randomUUID(),
      });
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

  const reset = () => setState({ ...INITIAL_STATE, mode: state.mode, scanSessionId: crypto.randomUUID() });

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-border flex items-center gap-3">
        <button onClick={reset} className="text-slate-400 hover:text-white">
          <RotateCcw size={18} />
        </button>
        <h2 className="text-base font-semibold text-white flex-1">
          Scanner Workflow
        </h2>
        <StepIndicator mode={state.mode} step={state.step} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Item scanned */}
        {state.item && (
          <ScanResultCard result={state.item} label="Item" />
        )}

        {/* Rack scanned */}
        {state.rack && (
          <ScanResultCard result={state.rack} label="Rack" />
        )}

        {/* Destination rack (transfer only) */}
        {state.destRack && (
          <ScanResultCard result={state.destRack} label="Destination Rack" />
        )}

        {/* Scanner or confirmation */}
        {state.step !== "confirm" ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-400 text-center">
              {state.step === "scan-item" && "Scan the item barcode"}
              {state.step === "scan-rack" && "Scan the rack / bin barcode"}
              {state.step === "scan-dest-rack" && "Scan destination rack barcode"}
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
            onModeChange={(mode) => {
              setState((prev) => {
                if (mode === "transfer" && !prev.destRack) {
                  return { ...prev, mode, step: "scan-dest-rack" };
                }
                if (mode !== "transfer") {
                  return { ...prev, mode, destRack: null, step: "confirm" };
                }
                return { ...prev, mode, step: "confirm" };
              });
            }}
            onQuantityChange={(q) => setState((p) => ({ ...p, quantity: q }))}
            onReferenceChange={(r) => setState((p) => ({ ...p, reference: r }))}
            onBorrowerChange={(b) => setState((p) => ({ ...p, borrower: b }))}
            onNotesChange={(n) => setState((p) => ({ ...p, notes: n }))}
            onScanDestination={
              state.mode === "transfer" && !state.destRack
                ? () => setState((p) => ({ ...p, step: "scan-dest-rack" }))
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
      onSubmit={(e) => {
        e.preventDefault();
        const clean = value.trim();
        if (!clean) return;
        onSubmit(clean);
        setValue("");
      }}
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
  state, onModeChange, onQuantityChange, onReferenceChange, onBorrowerChange, onNotesChange, onScanDestination, onCommit, loading,
}: {
  state: WorkflowState;
  onModeChange: (mode: WorkflowMode) => void;
  onQuantityChange: (q: string) => void;
  onReferenceChange: (r: string) => void;
  onBorrowerChange: (b: string) => void;
  onNotesChange: (n: string) => void;
  onScanDestination?: () => void;
  onCommit: () => void;
  loading: boolean;
}) {
  const modeButtons: Array<{ id: WorkflowMode; label: string; icon: React.ElementType; className: string }> = [
    { id: "stock-in", label: "Add", icon: ArrowUpRight, className: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10" },
    { id: "stock-out", label: "Remove", icon: ArrowDownRight, className: "text-red-400 border-red-500/50 bg-red-500/10" },
    { id: "transfer", label: "Transfer", icon: ArrowLeftRight, className: "text-blue-400 border-blue-500/50 bg-blue-500/10" },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-200">Confirm Transaction</h3>

      <div className="grid grid-cols-3 gap-2">
        {modeButtons.map(({ id, label, icon: Icon, className }) => (
          <button
            key={id}
            type="button"
            onClick={() => onModeChange(id)}
            className={clsx(
              "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors",
              state.mode === id
                ? className
                : "border-surface-border bg-surface-card text-slate-400 hover:text-white",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {state.mode === "transfer" && !state.destRack && onScanDestination && (
        <Button fullWidth onClick={onScanDestination} variant="secondary" leftIcon={<MapPin size={16} />}>
          Scan Destination Rack
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
          !state.item || !state.rack ||
          (state.mode === "transfer" && !state.destRack) ||
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
      ? ["scan-item", "scan-rack", "scan-dest-rack", "confirm"]
      : ["scan-item", "scan-rack", "confirm"];

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
